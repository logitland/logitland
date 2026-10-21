import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, EventsPage } from '@logitland/contracts';
import { Permission } from '@logitland/discord';
import { agree } from './consent.testkit';
import { contents, poll, say, setup, subscribe, useWebhook } from './deliveries.testkit';
import { HUMAN, human, push, world } from './intake-fixtures';
import { attemptDelivery, pushDue } from './services/deliveries';
import { removeReplies, revokeConsent } from './services/consent';
import { ingest } from './services/intake';
import { awardPost } from './services/xp/award';
import { GUILD, LOUNGE, seedAgent } from './testing';

afterEach(() => vi.restoreAllMocks());

describe('what digests may still carry, and what reading costs', () => {
  it('notifies a replies-only subscriber when a person withdraws', async () => {
    const { h, agent } = await world();
    await h.call('POST', '/v1/subscriptions', { kind: 'replies' }, h.as(agent.token));
    await push(h, human(1));
    const first = (await (await h.call('GET', '/v1/events', undefined, h.as(agent.token))).json()) as EventsPage;
    expect(first.digests.flatMap((d) => d.events).map((e) => e.type)).toEqual(['message.created']);
    await revokeConsent(h.relay, HUMAN, { type: 'public', id: HUMAN });
    await removeReplies(h.relay, HUMAN, { type: 'public', id: HUMAN });
    const next = (await (await h.call('GET', '/v1/events', undefined, h.as(agent.token))).json()) as EventsPage;
    expect(next.digests.flatMap((d) => d.events).map((e) => e.type)).toContain('message.bulk_deleted');
  });

  it('does not expose replies after the channel closes to this agent', async () => {
    const { h, agent } = await world();
    const role = '100000000000000022';
    await h.db
      .prepare('INSERT INTO guild_roles (id, guild_id, name, permissions, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(role, GUILD, 'higher level', '0', h.now().toISOString())
      .run();
    await h.db.prepare('UPDATE levels SET role_id = ? WHERE level = 3').bind(role).run();
    await h.db
      .prepare('UPDATE channels SET overwrites = ? WHERE id = ?')
      .bind(
        JSON.stringify([
          { id: GUILD, type: 0, deny: String(Permission.VIEW_CHANNEL), allow: '0' },
          { id: role, type: 0, deny: '0', allow: String(Permission.VIEW_CHANNEL) },
        ]),
        LOUNGE,
      )
      .run();
    await h.call('POST', '/v1/subscriptions', { kind: 'replies' }, h.as(agent.token));
    expect((await h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, h.as(agent.token))).status).toBe(404);
    await push(h, human(1, { content: 'secret after your access was removed' }));
    const events = await (await h.call('GET', '/v1/events', undefined, h.as(agent.token))).json();
    expect(JSON.stringify(events)).not.toContain('secret after your access was removed');
  });

  it('does not deliver a queued private digest after its recipient leaves', async () => {
    const s = await setup({ level: 3, harness: { env: { DELIVERIES: { send: async () => {} } } } });
    const other = await seedAgent(s.relay, { level: 3 });
    const opened = await s.call('POST', '/v1/conversations', { channel_id: LOUNGE, invite: [other.id] }, s.auth);
    expect(opened.status).toBe(201);
    const conv = (await opened.json()) as Conversation;
    await subscribe(s, { kind: 'conversation', channel_id: undefined });
    await ingest(s.relay, {
      source: 'test',
      events: [
        {
          kind: 'message_create',
          channel_id: LOUNGE,
          thread_id: conv.id,
          message_id: '310000000000099901',
          author: { id: '200000000000000050', username: 'bot', bot: true },
          content: 'private text queued before leaving',
          timestamp: s.now().toISOString(),
        },
      ],
    });
    await useWebhook(s);
    expect(await pushDue(s.relay, s.agent.id)).toBe(1);
    const delivery = await s.db.prepare('SELECT id FROM deliveries').first<{ id: string }>();
    expect((await s.call('POST', `/v1/conversations/${conv.id}/leave`, undefined, s.auth)).status).toBe(204);
    expect((await s.call('GET', `/v1/conversations/${conv.id}/messages`, undefined, s.auth)).status).toBe(404);
    await attemptDelivery(s.relay, delivery!.id);
    expect(JSON.stringify(s.received)).not.toContain('private text queued before leaving');
  });

  it('does not send deleted text after its deletion event has already been delivered', async () => {
    const s = await setup({ harness: { env: { DELIVERIES: { send: async () => {} } } } });
    await subscribe(s, { frequency: 'live' });
    await useWebhook(s);
    const id = await say(s, 'text that will be deleted');
    expect(await pushDue(s.relay, s.agent.id)).toBe(1);
    const original = await s.db.prepare('SELECT id FROM deliveries').first<{ id: string }>();
    await ingest(s.relay, { source: 'test', events: [{ kind: 'message_delete', channel_id: LOUNGE, message_id: id }] });
    expect(await pushDue(s.relay, s.agent.id)).toBe(1);
    const removal = await s.db.prepare('SELECT id FROM deliveries WHERE id != ?').bind(original!.id).first<{ id: string }>();
    await attemptDelivery(s.relay, removal!.id);
    expect(s.received.map(contents)).toEqual([['message.deleted']]);
    await attemptDelivery(s.relay, original!.id);
    expect(JSON.stringify(s.received)).not.toContain('text that will be deleted');
  });

  it('does not send a queued human reply once consent is revoked', async () => {
    const s = await setup({ harness: { env: { DELIVERIES: { send: async () => {} } } } });
    const mine = '299000000000000001';
    await s.db
      .prepare(
        "INSERT INTO conversation (message_id, channel_id, author_kind, agent_id, author_ref, display_name, content, created_at) VALUES (?, ?, 'agent', ?, ?, ?, 'question', ?)",
      )
      .bind(mine, LOUNGE, s.agent.id, s.agent.id, s.agent.name, s.now().toISOString())
      .run();
    await agree(s, HUMAN);
    await subscribe(s, { kind: 'replies' });
    await useWebhook(s);
    await ingest(s.relay, { source: 'test', events: [human(1, { content: 'a reply whose consent is revoked' })] });
    expect(await pushDue(s.relay, s.agent.id)).toBe(1);
    const delivery = await s.db.prepare('SELECT id FROM deliveries').first<{ id: string }>();
    await revokeConsent(s.relay, HUMAN, { type: 'public', id: HUMAN });
    await attemptDelivery(s.relay, delivery!.id);
    expect(JSON.stringify(s.received)).not.toContain('a reply whose consent is revoked');
  });

  it('keeps a webhook digest recoverable when its ledger insert fails', async () => {
    const s = await setup({ harness: { env: { DELIVERIES: { send: async () => {} } } } });
    await subscribe(s, { frequency: 'live' });
    await useWebhook(s);
    await say(s, 'must survive a failed write');
    vi.spyOn(s.db, 'batch').mockRejectedValueOnce(new Error('injected D1 failure'));
    await expect(pushDue(s.relay, s.agent.id)).rejects.toThrow('injected D1 failure');
    expect(await s.db.prepare('SELECT COUNT(*) AS n FROM deliveries').first()).toEqual({ n: 0 });
    expect(await pushDue(s.relay, s.agent.id)).toBe(1);
  });

  it('charges rereading subscription events against the read limit', async () => {
    const s = await setup();
    await s.db.prepare("UPDATE levels SET rules = json_set(rules, '$.limits.orphan.reads_per_minute', 1)").run();
    const sub = await subscribe(s);
    await say(s, 'content');
    expect((await s.call('GET', '/v1/channels', undefined, s.auth)).status).toBe(200);
    expect((await s.call('GET', '/v1/channels', undefined, s.auth)).status).toBe(429);
    expect((await s.call('GET', `/v1/subscriptions/${sub.id}/events?after=0`, undefined, s.auth)).status).toBe(429);
  });

  it('scores concurrent posts as the same burst just like sequential posts, and counts every one', async () => {
    const s = await setup();
    const words = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(
      ' ',
    );
    const texts = Array.from({ length: 8 }, (_, i) => [...words.slice(i), ...words.slice(0, i)].slice(0, 10).join(' '));
    const values = texts.map((text, i) => ({ agentId: s.agent.id, messageId: `test-message-${i}`, text, clean: true }));
    await Promise.all(values.map((v) => awardPost(s.relay, v)));
    const concurrent = await s.db.prepare('SELECT xp FROM agents WHERE id = ?').bind(s.agent.id).first<{ xp: number }>();
    const sequential = await setup();
    for (const v of values) await awardPost(sequential.relay, { ...v, agentId: sequential.agent.id });
    const expected = await sequential.db.prepare('SELECT xp FROM agents WHERE id = ?').bind(sequential.agent.id).first<{ xp: number }>();
    expect(concurrent!.xp).toBe(expected!.xp);
    expect(await s.db.prepare('SELECT COUNT(*) AS n FROM xp_events WHERE agent_id = ?').bind(s.agent.id).first()).toEqual({ n: texts.length });
  });
});
