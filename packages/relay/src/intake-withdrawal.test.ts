import { describe, expect, it } from 'vitest';
import { consentSweepJob, removePerson, revokeConsent } from './services/consent';
import { attemptDelivery } from './services/deliveries';
import { listEvents } from './services/events';
import { all, conversation, edit, eventTypes, HUMAN, human, one, push, subscribe, world } from './intake-fixtures';
import { GUILD } from './testing';

// What happens to a person's words when they leave while things are in flight, or the clean-up after them doesn't finish.

const leave = (h: Awaited<ReturnType<typeof world>>['h']) => revokeConsent(h.relay, HUMAN, { type: 'public', id: HUMAN });
const types = async (h: Awaited<ReturnType<typeof world>>['h']) => (await listEvents(h.relay, { after: 0, limit: 100 })).events.map((e) => e.type);

describe('an edit after the person left', () => {
  it('is not stored, recorded or sent, even before the clean-up has run', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, human(1, { content: 'written while agreed' }));
    await leave(h);
    const r = await push(h, edit(1, 'edited after leaving', 5));
    expect(r).toMatchObject({ recorded: 0, deliveries: 0, ignored: 1 });
    expect(await conversation(h, 1)).toMatchObject({ content: 'written while agreed', edited_at: null });
    expect(await eventTypes(h)).toEqual(['message.created']);
  });

  it('is refused by the statement itself when the person leaves between the round’s reads and its write', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, human(1, { content: 'written while agreed' }));
    const batch = h.db.batch.bind(h.db);
    h.db.batch = async (stmts) => {
      h.db.batch = batch;
      await leave(h);
      return batch(stmts);
    };
    await push(h, edit(1, 'edited after leaving', 5));
    h.db.batch = batch;
    expect(await conversation(h, 1)).toMatchObject({ content: 'written while agreed', edited_at: null });
    expect(await eventTypes(h)).toEqual(['message.created']);
  });
});

describe('a message in flight when the person leaves', () => {
  it('is not announced: no event, no delivery', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    const batch = h.db.batch.bind(h.db);
    h.db.batch = async (stmts) => {
      h.db.batch = batch;
      await leave(h);
      return batch(stmts);
    };
    const r = await push(h, human(1, { content: 'just before leaving' }));
    h.db.batch = batch;
    expect(r).toMatchObject({ recorded: 0, deliveries: 0 });
    expect(await eventTypes(h)).toEqual([]);
    // The row is hidden from readers at once and the sweep takes the rest.
    expect(await consentSweepJob(h.relay)).toBe(1);
    expect(await conversation(h, 1)).toMatchObject({ content: null, discord_user_id: null, removed_by: 'author' });
  });
});

describe('events of a person who left, before the clean-up reaches them', () => {
  it('are left out of GET /v1/events and dropped instead of delivered', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, human(1, { content: 'written while agreed' }), human(2, { content: 'second' }));
    expect(await types(h)).toEqual(['message.created', 'message.created']);
    await leave(h);
    expect(await types(h)).toEqual([]);
    const delivery = await one<{ id: string }>(h, 'SELECT id FROM deliveries ORDER BY id LIMIT 1');
    const out = await attemptDelivery(h.relay, delivery!.id);
    expect(out).toMatchObject({ outcome: 'dropped' });
    expect((await one<{ status: string }>(h, 'SELECT status FROM deliveries WHERE id = ?', delivery!.id))!.status).toBe('dropped');
  });
});

describe('the sweep after people who left', () => {
  it('finishes a clean-up that did not run, and leaves people who are still in alone', async () => {
    const { h } = await world();
    await push(h, human(1, { content: 'mine' }), human(2, { content: 'also mine' }));
    await leave(h);
    expect(await conversation(h, 1)).toMatchObject({ content: 'mine', discord_user_id: HUMAN });
    expect(await consentSweepJob(h.relay)).toBe(1);
    expect(await conversation(h, 1)).toMatchObject({ content: null, discord_user_id: null, display_name: 'Former participant' });
    expect(await all(h, "SELECT 1 FROM events WHERE type = 'message.bulk_deleted'")).toHaveLength(1);
    expect(await all(h, "SELECT 1 FROM audit_log WHERE action = 'person.messages_removed' AND actor_id = 'consent-sweep'")).toHaveLength(1);
    // Nothing left to do next time.
    expect(await consentSweepJob(h.relay)).toBe(0);
  });

  it('does nothing for someone who is still in', async () => {
    const { h } = await world();
    await push(h, human(1));
    expect(await consentSweepJob(h.relay)).toBe(0);
    expect(await conversation(h, 1)).toMatchObject({ content: 'message 1', discord_user_id: HUMAN });
  });
});

describe('leaving', () => {
  it('deletes the messages before it calls Discord about the role, so a request cut off in between has done the part that matters', async () => {
    const { h } = await world();
    h.relay.config.discord.consentRoleId = '500000000000000001';
    await push(h, human(1, { content: 'mine' }));
    await leave(h);
    const order: string[] = [];
    h.setDiscord(async (req) => {
      order.push(`discord ${req.method}`);
      expect((await conversation(h, 1))!.content).toBeNull();
      return Response.json({});
    });
    const r = await removePerson(h.relay, { discordUserId: HUMAN, guildId: GUILD, actor: { type: 'public', id: HUMAN } });
    expect(r).toMatchObject({ messages: 1, roleRemoved: true });
    expect(order).toEqual(['discord DELETE']);
  });
});
