import { newId } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { all, edit, human, msg, one, push, relayMessage, world } from './intake-fixtures';
import { handleScheduled } from './jobs';
import { retentionJob } from './services/retention';
import { seedDelivery } from './signup.helpers';

const DAY = 86_400_000;

type World = Awaited<ReturnType<typeof world>>;
const ago = (w: World, days: number) => new Date(w.h.now().getTime() - days * DAY).toISOString();

describe('retention', () => {
  it('blanks the text of the old event it keeps, and leaves the new ones and the conversation alone', async () => {
    const w = await world();
    const { h } = w;
    await push(h, human(1, { content: 'old words' }));
    h.advance(60_000);
    await push(h, edit(1, 'old edit', 5));
    h.advance(31 * DAY);
    await push(h, human(2, { content: 'new words' }));
    await retentionJob(h.relay);

    // The newest event older than 30 days is kept, without its text; the ones before it are gone.
    const events = await all<{ type: string; payload: string }>(h, 'SELECT type, payload FROM events ORDER BY seq');
    expect(events.map((e) => [e.type, JSON.parse(e.payload).data.content])).toEqual([
      ['message.updated', ''],
      ['message.created', 'new words'],
    ]);
    // Everything but the text is untouched.
    expect(JSON.parse(events[0]!.payload).data).toMatchObject({ message_id: msg(1), edited_at: expect.any(String) });
    // The conversation is the live projection and keeps its text.
    expect((await one<{ content: string }>(h, 'SELECT content FROM conversation WHERE message_id = ?', msg(1)))!.content).toBe('old edit');
  });

  it('finishes: a second run finds nothing left to do', async () => {
    const w = await world();
    await push(w.h, human(1));
    w.h.advance(31 * DAY);
    expect(await retentionJob(w.h.relay)).toBe(1);
    expect(await retentionJob(w.h.relay)).toBe(0);
  });

  it('keeps each statement bounded and works through a backlog in one run', async () => {
    const w = await world();
    const { h } = w;
    const old = ago(w, 400);
    for (let i = 0; i < 620; i++) {
      await h.db
        .prepare(
          "INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, created_at) VALUES (?, 'system', 'x', 'test', 'test', 'x', ?)",
        )
        .bind(newId('audit'), old)
        .run();
    }
    await h.db
      .prepare("INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, created_at) VALUES (?, 'system', 'x', 'test', 'test', 'x', ?)")
      .bind(newId('audit'), ago(w, 300))
      .run();
    // One run takes statement after statement until the backlog is gone: 620 rows is two statements of at most 500.
    expect(await retentionJob(h.relay)).toBe(620);
    expect(await retentionJob(h.relay)).toBe(0);
    expect(await all(h, 'SELECT 1 FROM audit_log')).toHaveLength(1);
  });

  it('deletes delivery attempts older than 30 days', async () => {
    const w = await world();
    const { h, agent } = w;
    const id = await seedDelivery(h, agent.id, 'failed');
    for (const [n, days] of [
      [1, 31],
      [2, 29],
    ] as const)
      await h.db
        .prepare('INSERT INTO delivery_attempts (delivery_id, n, started_at, status_code, duration_ms) VALUES (?, ?, ?, 500, 10)')
        .bind(id, n, ago(w, days))
        .run();
    expect(await retentionJob(h.relay)).toBe(1);
    expect((await all<{ n: number }>(h, 'SELECT n FROM delivery_attempts')).map((a) => a.n)).toEqual([2]);
  });

  it('nulls the text of blocked, held and failed messages after 90 days and of removed ones at once, and no other message', async () => {
    const w = await world();
    const { h, agent } = w;
    const rows: Record<string, string> = {};
    for (const [name, status, days] of [
      ['blockedOld', 'blocked', 91],
      ['heldOld', 'held', 100],
      ['failedOld', 'failed', 95],
      ['blockedNew', 'blocked', 80],
      ['sentOld', 'sent', 200],
      ['removedOld', 'removed', 200],
      ['removedNew', 'removed', 1],
    ] as const)
      rows[name] = await relayMessage(h, agent.id, { content: `text of ${name}`, status, createdAt: ago(w, days), hash: name });
    expect(await retentionJob(h.relay)).toBe(5);
    const content = Object.fromEntries(
      (await all<{ id: string; content: string | null }>(h, 'SELECT id, content FROM relay_messages')).map((r) => [r.id, r.content]),
    );
    expect(content[rows.blockedOld!]).toBeNull();
    expect(content[rows.heldOld!]).toBeNull();
    expect(content[rows.failedOld!]).toBeNull();
    expect(content[rows.blockedNew!]).toBe('text of blockedNew');
    expect(content[rows.sentOld!]).toBe('text of sentOld');
    expect(content[rows.removedOld!]).toBeNull();
    expect(content[rows.removedNew!]).toBeNull();
  });

  it('deletes used or expired proof-of-work challenges and decided or expired claims after 7 days', async () => {
    const w = await world();
    const { h, agent } = w;
    const challenge = (name: string, expiresDays: number, usedDays: number | null) =>
      h.db
        .prepare('INSERT INTO pow_challenges (id, difficulty, net_hmac, issued_at, expires_at, used_at) VALUES (?, 20, ?, ?, ?, ?)')
        .bind(`pow_${name}`, 'net', ago(w, expiresDays + 1), ago(w, expiresDays), usedDays === null ? null : ago(w, usedDays))
        .run();
    await challenge('usedOld', 10, 9);
    await challenge('usedNew', 3, 2);
    await challenge('expiredOld', 8, null);
    await challenge('expiredNew', 2, null);
    await challenge('open', -1, null);

    const claim = (code: string, expiresDays: number, decidedDays: number | null) =>
      h.db
        .prepare('INSERT INTO claims (user_code, agent_id, created_at, expires_at, decision, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, NULL, ?)')
        .bind(
          code,
          agent.id,
          ago(w, expiresDays + 1),
          ago(w, expiresDays),
          decidedDays === null ? null : 'deny',
          decidedDays === null ? null : ago(w, decidedDays),
        )
        .run();
    await claim('AAAA-0001', 7.5, 8);
    await claim('AAAA-0002', 1, 2);
    await claim('AAAA-0003', 8, null);
    await claim('AAAA-0004', 1, null);
    await claim('AAAA-0005', -1, null);

    expect(await retentionJob(h.relay)).toBe(4);
    expect((await all<{ id: string }>(h, 'SELECT id FROM pow_challenges ORDER BY id')).map((r) => r.id)).toEqual(['pow_expiredNew', 'pow_open', 'pow_usedNew']);
    expect((await all<{ user_code: string }>(h, 'SELECT user_code FROM claims ORDER BY user_code')).map((r) => r.user_code)).toEqual([
      'AAAA-0002',
      'AAAA-0004',
      'AAAA-0005',
    ]);
  });

  it('deletes audit and moderation log entries older than a year', async () => {
    const w = await world();
    const { h, agent } = w;
    for (const [name, days] of [
      ['old', 366],
      ['new', 364],
    ] as const) {
      await h.db
        .prepare("INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, created_at) VALUES (?, 'system', 'x', ?, 'test', 'x', ?)")
        .bind(newId('audit'), name, ago(w, days))
        .run();
      await h.db
        .prepare("INSERT INTO moderation_log (agent_id, layer, verdict, reason, created_at) VALUES (?, 'rules', 'pass', ?, ?)")
        .bind(agent.id, name, ago(w, days))
        .run();
    }
    expect(await retentionJob(h.relay)).toBe(2);
    expect((await all<{ action: string }>(h, 'SELECT action FROM audit_log')).map((r) => r.action)).toEqual(['new']);
    expect((await all<{ reason: string }>(h, 'SELECT reason FROM moderation_log')).map((r) => r.reason)).toEqual(['new']);
  });

  it('runs on the quarter hour from the cron job and logs its work', async () => {
    const w = await world({ start: '2026-10-19T03:00:00Z' });
    await push(w.h, human(1));
    w.h.advance(31 * DAY);
    const out = await handleScheduled(w.h.relay);
    expect(out.retention).toBe(1);
    expect(w.h.log.lines.some((l) => l.event === 'retention.done' && l.fields.rows === 1)).toBe(true);
  });
});
