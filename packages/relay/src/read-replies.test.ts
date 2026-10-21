import { describe, expect, it } from 'vitest';
import { at, fromWebhook, human, HUMAN, msg, push, remove, world } from './intake-fixtures';
import { hiddenReplyTargets, readPage, toConversationMessage, type ConversationRow } from './services/conversation';
import { recordAgentPost } from './services/intake';
import { scrubMessage, scrubPerson } from './services/scrub';
import { GUILD, LOUNGE, seedAgent } from './testing';
import { agree } from './consent.testkit';

const line = (name: string, target: number) => `-# ↪ Replying to **${name}** · https://discord.com/channels/${GUILD}/${LOUNGE}/${msg(target)}`;
type World = Awaited<ReturnType<typeof world>>;
/** A relay where HUMAN has not agreed to the mirror yet; `consent` records the agreement when a test wants it. */
const open = () => world({ agreed: false });

async function reply(w: World, n: number, target: number, name: string, text = 'I agree', agentId = w.agent.id) {
  await recordAgentPost(w.h.relay, {
    discordMessageId: msg(n),
    channelId: LOUNGE,
    threadId: null,
    agentId,
    displayName: 'Moth-9',
    content: `${line(name, target)}\n${text}`,
    relayMessageId: 'msg_01JB7Q2M8R',
    createdAt: at(0, n),
    replyTo: msg(target),
  });
}

const consent = (h: World['h'], revoked = false) => agree(h, HUMAN, { at: '2026-10-19T03:00:00.000Z', revokedAt: revoked ? '2026-10-19T03:30:00.000Z' : null });

const content = async (h: World['h'], n: number, view: 'agent' | 'public') =>
  (await readPage(h.relay, LOUNGE, { view })).messages.find((m) => m.message_id === msg(n))!.content;
const firstLine = async (h: World['h'], n: number, view: 'agent' | 'public') => (await content(h, n, view))!.split('\n')[0];

// Agents and the public read the same reply lines.
const VIEWS = ['agent', 'public'] as const;

describe('a reply line', () => {
  it('keeps the name of a person who had agreed to the mirror when they wrote the message', async () => {
    const w = await open();
    await consent(w.h);
    await push(w.h, human(1));
    await reply(w, 2, 1, 'Luna');
    for (const view of VIEWS) {
      expect(await firstLine(w.h, 2, view)).toBe(line('Luna', 1));
      expect(await content(w.h, 2, view)).toBe(`${line('Luna', 1)}\nI agree`);
    }
  });

  it('keeps “a person” for someone who had not agreed when the agent replied, even if they agree later', async () => {
    const w = await open();
    await push(w.h, human(1));
    await reply(w, 2, 1, 'a person');
    await consent(w.h);
    for (const view of VIEWS) expect(await firstLine(w.h, 2, view)).toBe(line('a person', 1));
  });

  it('hides the name of someone who never agreed, whatever the line says', async () => {
    const w = await open();
    await push(w.h, human(1));
    await reply(w, 2, 1, 'Luna');
    for (const view of VIEWS) {
      expect(await firstLine(w.h, 2, view)).toBe(line('a person', 1));
      expect(await content(w.h, 2, view)).toBe(`${line('a person', 1)}\nI agree`);
    }
  });

  it('hides the name of someone who agreed only after writing the message, whatever the line says', async () => {
    const w = await open();
    await push(w.h, human(1));
    await agree(w.h, HUMAN, { at: '2026-10-19T03:30:00.000Z' });
    await reply(w, 2, 1, 'Luna');
    for (const view of VIEWS) expect(await firstLine(w.h, 2, view)).toBe(line('a person', 1));
  });

  it('hides the name once the person has left the mirror', async () => {
    const w = await open();
    await consent(w.h);
    await push(w.h, human(1));
    await reply(w, 2, 1, 'Luna');
    expect(await firstLine(w.h, 2, 'public')).toBe(line('Luna', 1));
    await w.h.db.prepare("UPDATE consents SET revoked_at = '2026-10-19T04:00:00.000Z'").run();
    for (const view of VIEWS) expect(await firstLine(w.h, 2, view)).toBe(line('a person', 1));
  });

  it('hides it when the person’s message was removed, and after the person is anonymised', async () => {
    const w = await open();
    await consent(w.h);
    await push(w.h, human(1), human(3));
    await reply(w, 2, 1, 'Luna');
    await reply(w, 4, 3, 'Luna');
    await push(w.h, remove(1));
    expect(await firstLine(w.h, 2, 'public')).toBe(line('a person', 1));
    expect(await firstLine(w.h, 4, 'public')).toBe(line('Luna', 3));
    await scrubPerson(w.h.relay, HUMAN);
    expect(await firstLine(w.h, 4, 'public')).toBe(line('a person', 3));
  });

  it('hides it for a message a moderator took down', async () => {
    const w = await open();
    await consent(w.h);
    await push(w.h, human(1));
    await reply(w, 2, 1, 'Luna');
    await scrubMessage(w.h.relay, msg(1), 'moderator');
    expect(await firstLine(w.h, 2, 'public')).toBe(line('a person', 1));
  });

  it('hides it when the target is not stored, because nothing says whose name it is', async () => {
    const w = await world();
    await reply(w, 2, 99, 'Luna');
    expect(await firstLine(w.h, 2, 'public')).toBe(line('a person', 99));
  });

  it('keeps the name of an agent, and of a webhook, even after the message is gone', async () => {
    const w = await world();
    const other = await seedAgent(w.h.relay, { name: 'Otter-3' });
    await recordAgentPost(w.h.relay, {
      discordMessageId: msg(1),
      channelId: LOUNGE,
      threadId: null,
      agentId: other.id,
      displayName: 'Otter-3',
      content: 'hello',
      relayMessageId: 'msg_01JB7Q2M8Q',
      createdAt: at(0, 1),
    });
    await push(
      w.h,
      fromWebhook(3, 'Some Feed', 'news', { author: { id: '600000000000000077', username: 'Some Feed', bot: true, webhook_id: '600000000000000077' } }),
    );
    await reply(w, 2, 1, 'Otter-3');
    await reply(w, 4, 3, 'Some Feed');
    expect(await firstLine(w.h, 2, 'public')).toBe(line('Otter-3', 1));
    expect(await firstLine(w.h, 4, 'public')).toBe(line('Some Feed', 3));
    await scrubMessage(w.h.relay, msg(1), 'moderator');
    expect(await firstLine(w.h, 2, 'public')).toBe(line('Otter-3', 1));
  });

  it('changes only the first line, and only in a reply line', async () => {
    const w = await open();
    await push(w.h, human(1));
    await reply(w, 2, 1, 'Luna', `As **Luna** said, -# ↪ Replying to **Luna** · again\nReplying to **Luna** is fine`);
    await recordAgentPost(w.h.relay, {
      discordMessageId: msg(3),
      channelId: LOUNGE,
      threadId: null,
      agentId: w.agent.id,
      displayName: 'Moth-9',
      content: `Look: ${line('Luna', 1)}`,
      relayMessageId: 'msg_01JB7Q2M8R',
      createdAt: at(0, 3),
      replyTo: msg(1),
    });
    const body = (await content(w.h, 2, 'public'))!.split('\n');
    expect(body[0]).toBe(line('a person', 1));
    expect(body.slice(1).join('\n')).toBe('As **Luna** said, -# ↪ Replying to **Luna** · again\nReplying to **Luna** is fine');
    expect(await content(w.h, 3, 'public')).toBe(`Look: ${line('Luna', 1)}`);
  });

  it('is the same in the agent API as on the page', async () => {
    const w = await open();
    await push(w.h, human(1));
    await reply(w, 2, 1, 'Luna');
    const res = await w.h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, w.h.as(w.agent.key));
    const body = JSON.stringify(await res.json());
    expect(body).toContain('Replying to **a person**');
    expect(body).not.toContain('Luna');
  });

  it('looks up the whole page’s targets in one query', async () => {
    const w = await world();
    await push(w.h, human(1), human(2));
    for (let n = 3; n <= 12; n++) await reply(w, n, n % 2 === 0 ? 1 : 2, 'Luna');
    let queries = 0;
    const prepare = w.h.db.prepare.bind(w.h.db);
    w.h.db.prepare = (sql: string) => {
      queries++;
      return prepare(sql);
    };
    await readPage(w.h.relay, LOUNGE, { view: 'public' });
    expect(queries).toBe(2);
    queries = 0;
    await readPage(w.h.relay, LOUNGE, { view: 'agent' });
    expect(queries).toBe(2);
    // A page with no reply lines (here, only the two people’s messages) needs no extra query.
    queries = 0;
    await readPage(w.h.relay, LOUNGE, { view: 'public', before: msg(3) });
    expect(queries).toBe(1);
  });

  it('is decided by hiddenReplyTargets, which anything else showing agent text to readers can call', async () => {
    const w = await open();
    await consent(w.h);
    await push(w.h, human(1), human(2));
    const rows = [
      { author_kind: 'agent' as const, reply_to: msg(1), content: line('Luna', 1) },
      { author_kind: 'agent' as const, reply_to: msg(99), content: line('Luna', 99) },
      { author_kind: 'agent' as const, reply_to: msg(2), content: 'no reply line here' },
    ];
    expect([...(await hiddenReplyTargets(w.h.relay, rows))]).toEqual([msg(99)]);
    expect((await hiddenReplyTargets(w.h.relay, [])).size).toBe(0);
  });

  it('plays safe for a caller that has not looked anything up: every name in a reply line is hidden', () => {
    const row: ConversationRow = {
      message_id: msg(2),
      channel_id: LOUNGE,
      thread_id: null,
      author_kind: 'agent',
      agent_id: 'agt_01JB7Q2M8R',
      author_ref: 'agt_01JB7Q2M8R',
      discord_user_id: null,
      display_name: 'Moth-9',
      content: `${line('Luna', 1)}\nhi`,
      relay_message_id: null,
      created_at: at(0, 2),
      edited_at: null,
      deleted_at: null,
      removed_by: null,
      reply_to: msg(1),
      poll: null,
      withheld: 0,
      consented: 0,
    };
    for (const view of VIEWS) {
      expect(toConversationMessage(row, view).content).toBe(`${line('a person', 1)}\nhi`);
      expect(toConversationMessage(row, view, new Set()).content).toBe(`${line('Luna', 1)}\nhi`);
      expect(toConversationMessage(row, view, new Set([msg(1)])).content).toBe(`${line('a person', 1)}\nhi`);
    }
  });

  it('holds on the public agent profile too', async () => {
    const w = await open();
    await w.h.db.prepare('UPDATE channels SET public_mirror = 1 WHERE id = ?').bind(LOUNGE).run();
    await push(w.h, human(1));
    await reply(w, 2, 1, 'Luna');
    const res = await w.h.call('GET', `/public/agents/${w.agent.id}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('Replying to **a person**');
    expect(body).not.toContain('**Luna**');
  });
});
