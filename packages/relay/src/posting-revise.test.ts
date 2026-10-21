import { describe, expect, it, vi } from 'vitest';
import { sha256 } from './crypto';
import { scrubMessage } from './services/scrub';
import { activeStrikeCount } from './services/strikes';
import { normalise } from './services/moderation/rows';
import { updateSettings } from './services/settings';
import {
  ANNOUNCE,
  FORUM_ID,
  NEW_THREAD,
  WEBHOOK_MESSAGE,
  calls,
  converse,
  down,
  filler,
  json,
  mod,
  patch,
  pass,
  post,
  remove,
  row,
  say,
  world,
} from './posting-fixtures';
import { Permission } from '@logitland/discord';
import { ADMIN_DISCORD, GUILD, LOUNGE, seedAgent, seedOwner, type Harness } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));
vi.mock('./services/scrub', async (original) => ({ ...(await original<typeof import('./services/scrub')>()), scrubMessage: vi.fn(async () => {}) }));

const hours = (n: number) => n * 3_600_000;
const attempts = async (h: Harness, agentId: string) =>
  (await h.db.prepare('SELECT SUM(count) AS n FROM rate_counters WHERE key = ?').bind(`attempt:${agentId}:m`).first<{ n: number | null }>())?.n ?? 0;
const logOf = (h: Harness, id: string) =>
  h.db
    .prepare('SELECT layer, verdict, policy_code, reason, source FROM moderation_log WHERE message_id = ? ORDER BY id')
    .bind(id)
    .all<Record<string, any>>()
    .then((r) => r.results);
const audits = (h: Harness, action: string) =>
  h.db
    .prepare('SELECT * FROM audit_log WHERE action = ?')
    .bind(action)
    .all<Record<string, any>>()
    .then((r) => r.results);

async function sent(w: Awaited<ReturnType<typeof world>>, text = 'The first version of this message', extra: Record<string, unknown> = {}, channel = LOUNGE) {
  const msg = await json(await post(w.h, w.a, say(text, extra, channel)));
  expect(msg.status).toBe('sent');
  return msg;
}

describe('editing a message', () => {
  it('changes the text on Discord through the webhook and in the relay', async () => {
    const w = await world();
    const msg = await sent(w);
    const res = await patch(w.h, w.a, msg.id, { content: 'The second version of this message' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      id: msg.id,
      status: 'sent',
      content: 'The second version of this message',
      discord_message_id: msg.discord_message_id,
    });
    const [edit] = await calls(w.h, 'PATCH', WEBHOOK_MESSAGE);
    expect(edit!.url.pathname).toMatch(new RegExp(`/messages/${msg.discord_message_id}$`));
    expect(edit!.body).toEqual({ content: 'The second version of this message', allowed_mentions: { parse: [] } });
    expect(edit!.url.searchParams.has('thread_id')).toBe(false);
    const stored = await row(w.h, msg.id);
    expect(stored).toMatchObject({ content: 'The second version of this message', status: 'sent' });
    expect(stored!.content_hash).toBe(await sha256(normalise('The second version of this message')));
    expect(stored!.updated_at).toBeTruthy();
  });

  it('runs the fixed rules and the classifier again and counts as an attempt, not a post', async () => {
    const moderator = mod();
    const w = await world({ moderator });
    const msg = await sent(w);
    const before = await attempts(w.h, w.a.id);
    await patch(w.h, w.a, msg.id, { content: 'The second version of this message' });
    expect(moderator.calls).toHaveLength(2);
    expect(moderator.calls[1]).toMatchObject({ message_id: msg.id, kind: 'message', content: 'The second version of this message' });
    expect(await attempts(w.h, w.a.id)).toBe(before + 1);
    const posts = await w.h.db.prepare('SELECT count FROM rate_counters WHERE key = ?').bind(`post:${w.a.id}:m`).first<{ count: number }>();
    expect(posts!.count).toBe(1);
    const log = await logOf(w.h, msg.id);
    expect(log.filter((l) => l.reason?.startsWith('Edit')).map((l) => `${l.layer}:${l.verdict}`)).toEqual(['rules:pass', 'classifier:pass']);
    expect((await audits(w.h, 'message.edited'))[0]).toMatchObject({ actor_type: 'agent', actor_id: w.a.id, target_id: msg.id });
  });

  it('gives the classifier the conversation as context', async () => {
    const moderator = mod();
    const w = await world({ moderator });
    const msg = await sent(w);
    await converse(w.h, { author: 'bot', name: 'Ann', content: 'someone said this before' });
    await patch(w.h, w.a, msg.id, { content: 'A better version of this message' });
    expect(moderator.calls[1]!.context).toContainEqual({ author: 'Ann', content: 'someone said this before' });
  });

  it('keeps a reply line above the new text', async () => {
    const w = await world();
    const target = await converse(w.h, { author: 'agent', name: 'Orrery' });
    const msg = await sent(w, 'Replying to Orrery', { reply_to: target });
    await patch(w.h, w.a, msg.id, { content: 'Replying to Orrery, corrected' });
    const [edit] = await calls(w.h, 'PATCH', WEBHOOK_MESSAGE);
    expect(edit!.body.content).toBe(`${(await row(w.h, msg.id))!.reply_prefix}\nReplying to Orrery, corrected`);
    expect((await row(w.h, msg.id))!.content).toBe('Replying to Orrery, corrected');
    expect((await row(w.h, msg.id))!.content_hash).toBe(await sha256(normalise(edit!.body.content)));
  });

  it('refuses text that would push a reply line past 2,000 characters', async () => {
    const w = await world();
    const target = await converse(w.h, { author: 'agent', name: 'Orrery' });
    const msg = await sent(w, 'Replying to Orrery', { reply_to: target });
    const res = await patch(w.h, w.a, msg.id, { content: filler(2000) });
    expect(res.status).toBe(400);
    expect((await json(res)).detail).toMatch(/Cut \d+ characters/);
    expect(await calls(w.h, 'PATCH', WEBHOOK_MESSAGE)).toHaveLength(0);
  });

  it('names the thread for a message posted inside one', async () => {
    const w = await world();
    const msg = await sent(w, 'Inside a thread', { thread_id: NEW_THREAD });
    await patch(w.h, w.a, msg.id, { content: 'Inside a thread, edited' });
    expect((await calls(w.h, 'PATCH', WEBHOOK_MESSAGE))[0]!.url.searchParams.get('thread_id')).toBe(NEW_THREAD);
  });

  it('names the thread for a forum post, but not for the starter message of a text-channel thread', async () => {
    const w = await world();
    const forum = await sent(w, 'A forum post', { thread_name: 'Title' }, FORUM_ID);
    expect(forum.thread_id).toBe(NEW_THREAD);
    await patch(w.h, w.a, forum.id, { content: 'A forum post, edited' });
    const textThread = await sent(w, 'A thread starter', { thread_name: 'Title' });
    expect(textThread.thread_id).toBe(textThread.discord_message_id);
    await patch(w.h, w.a, textThread.id, { content: 'A thread starter, edited' });
    const edits = await calls(w.h, 'PATCH', WEBHOOK_MESSAGE);
    expect(edits[0]!.url.searchParams.get('thread_id')).toBe(NEW_THREAD);
    // The starter message lives in the channel; the thread hangs off it.
    expect(edits[1]!.url.searchParams.has('thread_id')).toBe(false);
  });

  it('does nothing when the text is unchanged', async () => {
    const moderator = mod();
    const w = await world({ moderator });
    const msg = await sent(w);
    const res = await patch(w.h, w.a, msg.id, { content: 'The first version of this message' });
    expect(res.status).toBe(200);
    expect(moderator.calls).toHaveLength(1);
    expect(await calls(w.h, 'PATCH', WEBHOOK_MESSAGE)).toHaveLength(0);
  });

  describe('when the new text is not allowed', () => {
    it.each([
      ['an invite', 'come to discord.gg/abc123', 'invite_link'],
      ['personal details, which are held for a new message but never for an edit', 'write to me@example.com', 'personal_info'],
      ['a credential', `my token lat_${'K7QMXV2D'.repeat(6)}`, 'secret_leak'],
      ['spam', 'a'.repeat(50), 'spam'],
      ['a blocked link', 'see bit.ly/abc', 'blocked_domain'],
    ])('answers 422 with the policy code and leaves the message alone: %s', async (_name, content, policy) => {
      const w = await world();
      const msg = await sent(w);
      const res = await patch(w.h, w.a, msg.id, { content });
      expect(res.status).toBe(422);
      const problem = await json(res);
      expect(problem).toMatchObject({ code: 'invalid_request', policy_code: policy });
      expect(problem.detail).toMatch(/Your edit was not applied: the message still reads as before\./);
      expect(await calls(w.h, 'PATCH', WEBHOOK_MESSAGE)).toHaveLength(0);
      expect(await row(w.h, msg.id)).toMatchObject({ content: 'The first version of this message', status: 'sent' });
      const log = (await logOf(w.h, msg.id)).find((l) => l.layer === 'rules' && l.reason?.startsWith('Edit: '));
      expect(log).toMatchObject({ verdict: policy === 'personal_info' || policy === 'spam' ? 'hold' : 'block', policy_code: policy });
    });

    it('does not keep the text of a credential anywhere', async () => {
      const w = await world();
      const msg = await sent(w);
      const secret = `lat_${'K7QMXV2D'.repeat(6)}`;
      await patch(w.h, w.a, msg.id, { content: `my token ${secret}` });
      expect(JSON.stringify(await w.h.db.prepare('SELECT * FROM relay_messages').all())).not.toContain(secret);
      expect(JSON.stringify(await w.h.db.prepare('SELECT * FROM moderation_log').all())).not.toContain(secret);
    });

    it('refuses a new link where the agent’s roles lack Embed Links, too', async () => {
      const w = await world();
      const msg = await json(await post(w.h, w.a, say('Plain words, no link')));
      expect(msg.status).toBe('sent');
      const noLinks = [{ id: GUILD, type: 0, allow: '0', deny: String(Permission.EMBED_LINKS) }];
      await w.h.db.prepare('UPDATE channels SET overwrites = ? WHERE id = ?').bind(JSON.stringify(noLinks), LOUNGE).run();
      const res = await patch(w.h, w.a, msg.id, { content: 'Now with a link https://example.com/page' });
      expect(res.status).toBe(422);
      expect((await json(res)).policy_code).toBe('links_not_allowed');
    });

    it('answers 422 for a classifier block, and for a hold, without holding the edit', async () => {
      const moderator = mod((req) =>
        req.content.includes('hold')
          ? { verdict: 'hold', policy_code: 'sexual' }
          : req.content.includes('block')
            ? { verdict: 'block', policy_code: 'self_harm' }
            : pass,
      );
      const w = await world({ moderator });
      const msg = await sent(w);
      const blocked = await patch(w.h, w.a, msg.id, { content: 'something to block' });
      expect(blocked.status).toBe(422);
      expect(await json(blocked)).toMatchObject({ policy_code: 'self_harm' });
      const held = await patch(w.h, w.a, msg.id, { content: 'something to hold' });
      expect(held.status).toBe(422);
      expect(await json(held)).toMatchObject({ policy_code: 'sexual' });
      expect(await row(w.h, msg.id)).toMatchObject({ status: 'sent', content: 'The first version of this message' });
      expect((await w.h.db.prepare("SELECT COUNT(*) AS n FROM relay_messages WHERE status = 'held'").first<{ n: number }>())!.n).toBe(0);
      const classifierRows = (await logOf(w.h, msg.id)).filter((l) => l.layer === 'classifier' && l.reason?.startsWith('Edit: '));
      expect(classifierRows.map((l) => l.verdict)).toEqual(['block', 'hold']);
    });

    it('adds a strike for a severe block by the main classifier, as it would for a new message', async () => {
      const moderator = mod((req) => (req.content.includes('violent') ? { verdict: 'block', policy_code: 'violence' } : pass));
      const w = await world({ moderator });
      const msg = await sent(w);
      const res = await patch(w.h, w.a, msg.id, { content: 'something violent' });
      expect(res.status).toBe(422);
      expect((await json(res)).detail).toMatch(/That is a warning \(1 active strike\)/);
      expect(await activeStrikeCount(w.h.relay, w.a.id)).toBe(1);
    });

    it('answers 503 when nothing can judge the edit, whatever the outage setting', async () => {
      let up = true;
      const moderator = mod(() => (up ? pass : down));
      const w = await world({ moderator });
      const msg = await sent(w);
      up = false;
      for (const setting of ['hold', 'refuse'] as const) {
        w.h.relay.config.moderationOutage = setting;
        const res = await patch(w.h, w.a, msg.id, { content: `An edit while moderation is down (${setting})` });
        expect(res.status).toBe(503);
        expect(await json(res)).toMatchObject({ code: 'moderation_unavailable', policy_code: 'outage' });
        expect(res.headers.get('retry-after')).toBeTruthy();
      }
      expect(await calls(w.h, 'PATCH', WEBHOOK_MESSAGE)).toHaveLength(0);
      expect((await row(w.h, msg.id))!.content).toBe('The first version of this message');
    });
  });

  describe('which messages may be edited', () => {
    it('only within 24 hours of being posted', async () => {
      const w = await world();
      const msg = await sent(w);
      w.h.advance(hours(24) - 1000);
      expect((await patch(w.h, w.a, msg.id, { content: 'Edited just in time' })).status).toBe(200);
      w.h.advance(2000);
      const late = await patch(w.h, w.a, msg.id, { content: 'Edited too late' });
      expect(late.status).toBe(409);
      expect(await json(late)).toMatchObject({ code: 'expired', detail: expect.stringMatching(/within 24 hours/) });
      expect((await row(w.h, msg.id))!.content).toBe('Edited just in time');
    });

    it('counts the 24 hours from when it was posted, not from when it was asked for', async () => {
      const queued: string[] = [];
      const w = await world({ sender: { enqueue: async (_c, id) => void queued.push(id) } });
      const msg = await json(await post(w.h, w.a, say('Waits in the queue')));
      expect(msg.status).toBe('queued');
      w.h.advance(hours(30));
      const { processSend } = await import('./services/sending');
      await processSend(w.h.relay, queued[0]!);
      expect((await patch(w.h, w.a, msg.id, { content: 'Posted long after it was asked for' })).status).toBe(200);
    });

    it('only messages that were posted', async () => {
      const queued: string[] = [];
      const w = await world({ sender: { enqueue: async (_c, id) => void queued.push(id) } });
      const waiting = await json(await post(w.h, w.a, say('Waiting in line')));
      const blocked = await json(await post(w.h, w.a, say('come to discord.gg/abc123')));
      const held = await json(await post(w.h, w.a, say('write to me@example.com')));
      for (const [msg, status] of [
        [waiting, 'queued'],
        [blocked, 'blocked'],
        [held, 'held'],
      ] as const) {
        const res = await patch(w.h, w.a, msg.id, { content: 'Trying to edit it' });
        expect(res.status, status).toBe(409);
        expect((await json(res)).detail).toContain(`this one is ${status}`);
      }
    });

    it('not one that was deleted', async () => {
      const w = await world();
      const msg = await sent(w);
      await remove(w.h, w.a, msg.id);
      const res = await patch(w.h, w.a, msg.id, { content: 'Edit after delete' });
      expect(res.status).toBe(409);
      expect((await json(res)).detail).toMatch(/was deleted/);
    });

    it('not a message Discord never confirmed', async () => {
      const w = await world();
      const msg = await sent(w);
      await w.h.db.prepare('UPDATE relay_messages SET discord_message_id = NULL WHERE id = ?').bind(msg.id).run();
      expect((await patch(w.h, w.a, msg.id, { content: 'Edit without an ID' })).status).toBe(409);
    });

    it('only the agent’s own', async () => {
      const w = await world();
      const msg = await sent(w);
      const other = await seedAgent(w.h.relay);
      expect((await patch(w.h, other, msg.id, { content: 'Not yours to edit' })).status).toBe(404);
      expect((await patch(w.h, w.a, 'msg_NOSUCHMESSAGE0', { content: 'No such message' })).status).toBe(404);
    });

    it('with new text, not blank and not missing', async () => {
      const w = await world();
      const msg = await sent(w);
      expect((await patch(w.h, w.a, msg.id, { content: '   ' })).status).toBe(400);
      expect((await patch(w.h, w.a, msg.id, {})).status).toBe(400);
      expect((await patch(w.h, w.a, msg.id, { content: 'x'.repeat(2001) })).status).toBe(400);
    });

    it('with the messages:write scope', async () => {
      const w = await world();
      const msg = await sent(w);
      const reader = await seedAgent(w.h.relay, { scopes: ['messages:read'] });
      expect((await patch(w.h, reader, msg.id, { content: 'Reader editing' })).status).toBe(403);
    });
  });

  describe('limits and switches', () => {
    it('counts toward the attempt limit, so edits cannot be used to probe the classifier without end', async () => {
      const w = await world();
      const msg = await sent(w);
      let last = 200;
      for (let i = 0; i < 45 && last !== 429; i++)
        last = (await patch(w.h, w.a, msg.id, { content: `Probing the rules, try number ${i} with some padding` })).status;
      expect(last).toBe(429);
    });

    it('stops while the relay is read-only, and while the agent is paused', async () => {
      const w = await world();
      const msg = await sent(w);
      const admin = await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin');
      await updateSettings(w.h.relay, admin.id, { relay_read_only: true });
      const ro = await patch(w.h, w.a, msg.id, { content: 'Edit in read-only mode' });
      expect(ro.status).toBe(503);
      expect((await json(ro)).code).toBe('unavailable');
      await updateSettings(w.h.relay, admin.id, { relay_read_only: false });
      await w.h.db
        .prepare('UPDATE agents SET posting_paused_until = ? WHERE id = ?')
        .bind(new Date(w.h.now().getTime() + 60_000).toISOString(), w.a.id)
        .run();
      expect((await patch(w.h, w.a, msg.id, { content: 'Edit while paused' })).status).toBe(403);
    });
  });

  describe('when Discord does not cooperate', () => {
    it.each([
      [404, 409, 'conflict', /no longer has this message/],
      [403, 503, 'unavailable', /Discord refused to edit/],
    ])('turns Discord’s %i into %i', async (discordStatus, status, code, detail) => {
      const w = await world();
      const msg = await sent(w);
      w.h.setDiscord(() => Response.json({ message: 'raw discord text', code: 50001 }, { status: discordStatus }));
      const res = await patch(w.h, w.a, msg.id, { content: 'Edit that Discord refuses' });
      expect(res.status).toBe(status);
      const problem = await json(res);
      expect(problem.code).toBe(code);
      expect(problem.detail).toMatch(detail);
      expect(JSON.stringify(problem)).not.toContain('raw discord text');
      expect((await row(w.h, msg.id))!.content).toBe('The first version of this message');
    });

    it('passes Discord’s rate limit on as a 429 with a wait', async () => {
      const w = await world();
      const msg = await sent(w);
      w.h.setDiscord(
        () => new Response(JSON.stringify({ retry_after: 3 }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '3' } }),
      );
      const res = await patch(w.h, w.a, msg.id, { content: 'Edit into a rate limit' });
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('3');
    });

    it('says what to do when the channel has lost its webhook', async () => {
      const w = await world();
      const msg = await sent(w);
      await w.h.db.prepare('UPDATE channels SET webhook_ciphertext = NULL WHERE id = ?').bind(LOUNGE).run();
      const res = await patch(w.h, w.a, msg.id, { content: 'Edit without a webhook' });
      expect(res.status).toBe(409);
      expect((await json(res)).detail).toMatch(/webhook/);
    });
  });
});

describe('deleting a message', () => {
  it('removes a posted message from Discord through the webhook and scrubs every copy', async () => {
    const w = await world();
    const msg = await sent(w);
    const res = await remove(w.h, w.a, msg.id);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: msg.id, status: 'removed', status_reason: 'Deleted by its author.' });
    const [del] = await calls(w.h, 'DELETE', WEBHOOK_MESSAGE);
    expect(del!.url.pathname).toMatch(new RegExp(`/messages/${msg.discord_message_id}$`));
    expect(del!.url.searchParams.has('thread_id')).toBe(false);
    expect(scrubMessage).toHaveBeenLastCalledWith(w.h.relay, msg.discord_message_id, 'author', { channelId: LOUNGE });
    expect((await audits(w.h, 'message.deleted'))[0]).toMatchObject({ actor_type: 'agent', actor_id: w.a.id, target_id: msg.id });
  });

  it('names the thread for a message in a thread, but not for a text-channel thread’s starter', async () => {
    const w = await world();
    const inThread = await sent(w, 'Inside a thread', { thread_id: NEW_THREAD });
    const forum = await sent(w, 'A forum post', { thread_name: 'Title' }, FORUM_ID);
    const starter = await sent(w, 'A thread starter', { thread_name: 'Title' }, ANNOUNCE);
    for (const m of [inThread, forum, starter]) expect((await remove(w.h, w.a, m.id)).status).toBe(200);
    const deletes = await calls(w.h, 'DELETE', WEBHOOK_MESSAGE);
    expect(deletes.map((d) => d.url.searchParams.get('thread_id'))).toEqual([NEW_THREAD, NEW_THREAD, null]);
  });

  it('is idempotent: a second delete changes nothing and calls Discord no more', async () => {
    const w = await world();
    const msg = await sent(w);
    await remove(w.h, w.a, msg.id);
    expect((await remove(w.h, w.a, msg.id)).status).toBe(200);
    expect(await calls(w.h, 'DELETE', WEBHOOK_MESSAGE)).toHaveLength(1);
  });

  it('counts a message Discord has already lost as deleted', async () => {
    const w = await world();
    const msg = await sent(w);
    w.h.setDiscord(() => Response.json({ message: 'Unknown Message', code: 10008 }, { status: 404 }));
    expect((await remove(w.h, w.a, msg.id)).status).toBe(200);
    expect((await row(w.h, msg.id))!.status).toBe('removed');
  });

  it('cancels a queued message without calling Discord, and it is never sent', async () => {
    const queued: string[] = [];
    const w = await world({ sender: { enqueue: async (_c, id) => void queued.push(id) } });
    const msg = await json(await post(w.h, w.a, say('Waiting in line')));
    expect(msg.status).toBe('queued');
    const res = await remove(w.h, w.a, msg.id);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'removed', status_reason: 'Cancelled by its author. It was never posted.' });
    const { processSend } = await import('./services/sending');
    expect(await processSend(w.h.relay, queued[0]!)).toEqual({});
    expect(w.h.discordCalls).toHaveLength(0);
    expect(scrubMessage).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'author', expect.anything());
  });

  it('cancels a held message without calling Discord, which frees a place in the review queue', async () => {
    const w = await world();
    const msg = await json(await post(w.h, w.a, say('write to me@example.com')));
    expect(msg.status).toBe('held');
    expect(await json(await remove(w.h, w.a, msg.id))).toMatchObject({ status: 'removed' });
    expect(w.h.discordCalls).toHaveLength(0);
    expect((await w.h.db.prepare("SELECT COUNT(*) AS n FROM relay_messages WHERE status = 'held'").first<{ n: number }>())!.n).toBe(0);
    const queue = await w.h.internal('GET', '/internal/admin/moderation/queue', undefined, {
      'x-logitland-owner': (await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin')).id,
    });
    expect((await json(queue)).size).toBe(0);
  });

  it('cancels a failed message, so it cannot be retried', async () => {
    const w = await world();
    w.h.setDiscord(() => Response.json({ message: 'nope' }, { status: 400 }));
    const k = 'cancel-failed-key-padding';
    const msg = await json(await post(w.h, w.a, say('Fails to send'), k));
    expect(msg.status).toBe('failed');
    expect((await remove(w.h, w.a, msg.id)).status).toBe(200);
    const again = await json(await post(w.h, w.a, say('Fails to send'), k));
    expect(again).toMatchObject({ id: msg.id, status: 'removed' });
    expect(await calls(w.h, 'POST', /webhooks/)).toHaveLength(1);
  });

  it.each([
    ['moderating', /still being checked/],
    ['sending', /being posted right now/],
    ['uncertain', /Discord didn’t confirm/],
    ['blocked', /was blocked/],
  ])('refuses to touch a message that is %s', async (status, detail) => {
    const w = await world();
    const msg = await sent(w);
    await w.h.db.prepare('UPDATE relay_messages SET status = ?, discord_message_id = NULL WHERE id = ?').bind(status, msg.id).run();
    const res = await remove(w.h, w.a, msg.id);
    expect(res.status).toBe(409);
    expect((await json(res)).detail).toMatch(detail);
    expect((await row(w.h, msg.id))!.status).toBe(status);
    expect(await calls(w.h, 'DELETE', WEBHOOK_MESSAGE)).toHaveLength(0);
  });

  it('leaves a posted message in place and says so when Discord refuses', async () => {
    const w = await world();
    const msg = await sent(w);
    vi.mocked(scrubMessage).mockClear();
    w.h.setDiscord(() => Response.json({ message: 'raw discord text', code: 50013 }, { status: 403 }));
    const res = await remove(w.h, w.a, msg.id);
    expect(res.status).toBe(503);
    expect(JSON.stringify(await json(res))).not.toContain('raw discord text');
    expect((await row(w.h, msg.id))!.status).toBe('sent');
    expect(scrubMessage).not.toHaveBeenCalled();
  });

  it('passes Discord’s rate limit on, and explains a missing webhook', async () => {
    const w = await world();
    const msg = await sent(w);
    w.h.setDiscord(
      () => new Response(JSON.stringify({ retry_after: 4 }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '4' } }),
    );
    const limited = await remove(w.h, w.a, msg.id);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('4');
    await w.h.db.prepare('UPDATE channels SET webhook_ciphertext = NULL WHERE id = ?').bind(LOUNGE).run();
    expect((await remove(w.h, w.a, msg.id)).status).toBe(409);
  });

  it('is only for the agent’s own messages', async () => {
    const w = await world();
    const msg = await sent(w);
    const other = await seedAgent(w.h.relay);
    expect((await remove(w.h, other, msg.id)).status).toBe(404);
    expect((await remove(w.h, w.a, 'msg_NOSUCHMESSAGE0')).status).toBe(404);
    const reader = await seedAgent(w.h.relay, { scopes: ['messages:read'] });
    expect((await remove(w.h, reader, msg.id)).status).toBe(403);
  });

  it('works while the relay is read-only or the agent is paused: taking something back is always allowed', async () => {
    const w = await world();
    const one = await sent(w, 'First, to delete in read-only mode');
    const two = await sent(w, 'Second, to delete while paused');
    const admin = await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin');
    await updateSettings(w.h.relay, admin.id, { relay_read_only: true });
    expect((await remove(w.h, w.a, one.id)).status).toBe(200);
    await updateSettings(w.h.relay, admin.id, { relay_read_only: false });
    await w.h.db
      .prepare('UPDATE agents SET posting_paused_until = ? WHERE id = ?')
      .bind(new Date(w.h.now().getTime() + 3_600_000).toISOString(), w.a.id)
      .run();
    expect((await remove(w.h, w.a, two.id)).status).toBe(200);
  });

  it('does not count against the attempt limit', async () => {
    const w = await world();
    const msg = await sent(w);
    const before = await attempts(w.h, w.a.id);
    await remove(w.h, w.a, msg.id);
    expect(await attempts(w.h, w.a.id)).toBe(before);
  });

  it('lets the same text be sent again afterwards: a deleted message is not a repeat', async () => {
    const w = await world();
    const text = 'The very same text, sent twice';
    const msg = await sent(w, text);
    expect((await json(await post(w.h, w.a, say(text)))).policy_code).toBe('duplicate');
    await remove(w.h, w.a, msg.id);
    expect((await json(await post(w.h, w.a, say(text)))).status).toBe('sent');
  });
});
