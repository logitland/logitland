import { newId } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { all, edit, human, msg, one, push, relayMessage, remove, subscribe, world } from './intake-fixtures';
import { RULES, retentionJob } from './services/retention';

const DAY = 86_400_000;

type World = Awaited<ReturnType<typeof world>>;
const ago = (w: World, days: number) => new Date(w.h.now().getTime() - days * DAY).toISOString();

describe('pruning by age, children first', () => {
  it('deletes old attempts, then finished deliveries, then the events nothing refers to, without breaking a foreign key', async () => {
    const w = await world();
    const { h, agent } = w;
    await subscribe(h, agent.id);
    await push(h, human(1), human(2), human(3));
    const deliveries = await all<{ id: string; event_id: string }>(h, 'SELECT id, event_id FROM deliveries ORDER BY id');
    expect(deliveries).toHaveLength(3);
    for (const d of deliveries) {
      await h.db.prepare("UPDATE deliveries SET status = 'delivered', delivered_at = created_at, attempts = 1 WHERE id = ?").bind(d.id).run();
      await h.db
        .prepare('INSERT INTO delivery_attempts (delivery_id, n, started_at, status_code, duration_ms) VALUES (?, 1, ?, 200, 5)')
        .bind(d.id, h.now().toISOString())
        .run();
    }
    h.advance(31 * DAY);
    await push(h, human(4));

    await retentionJob(h.relay);
    expect(await all(h, 'SELECT 1 FROM delivery_attempts')).toEqual([]);
    expect(await all(h, 'SELECT 1 FROM deliveries WHERE created_at < ?', ago(w, 30))).toEqual([]);
    // Left: the newest old event (how /v1/events knows a cursor is too old) and the new one, with its delivery.
    const events = await all<{ source_key: string }>(h, 'SELECT source_key FROM events ORDER BY seq');
    expect(events.map((e) => e.source_key)).toEqual([`create:${msg(3)}`, `create:${msg(4)}`]);
    expect(await all(h, 'SELECT 1 FROM deliveries')).toHaveLength(1);
  });

  it('keeps an event a delivery still waits on, and a finished delivery whose attempts are recent', async () => {
    const w = await world();
    const { h, agent } = w;
    await subscribe(h, agent.id);
    await push(h, human(1), human(2), human(3));
    const rows = await all<{ id: string }>(h, 'SELECT id FROM deliveries ORDER BY id');
    await h.db.prepare("UPDATE deliveries SET status = 'failed', attempts = 24 WHERE id = ?").bind(rows[1]!.id).run();
    await h.db
      .prepare('INSERT INTO delivery_attempts (delivery_id, n, started_at, status_code, duration_ms) VALUES (?, 24, ?, 500, 5)')
      .bind(rows[1]!.id, h.now().toISOString())
      .run();
    h.advance(31 * DAY);
    await h.db.prepare('UPDATE delivery_attempts SET started_at = ? WHERE delivery_id = ?').bind(ago(w, 1), rows[1]!.id).run();
    await push(h, human(4));

    await retentionJob(h.relay);
    const left = await all<{ id: string; status: string }>(h, 'SELECT id, status FROM deliveries ORDER BY id');
    // Two pending ones (not finished) and the failed one with a recent attempt, plus the new event's.
    expect(left.map((d) => d.status).sort()).toEqual(['failed', 'pending', 'pending', 'pending']);
    expect(await all(h, 'SELECT 1 FROM events')).toHaveLength(4);
  });

  it('never deletes a removal event: intake needs it to stop a late create from bringing the text back', async () => {
    const w = await world();
    const { h } = w;
    await push(h, human(1), remove(1));
    const before = await all<{ type: string; source_key: string }>(h, 'SELECT type, source_key FROM events ORDER BY seq');
    expect(before.map((e) => e.type)).toEqual(['message.created', 'message.deleted']);
    h.advance(400 * DAY);
    await push(h, human(2));
    await retentionJob(h.relay);
    await retentionJob(h.relay);
    const keys = (await all<{ source_key: string }>(h, 'SELECT source_key FROM events ORDER BY seq')).map((e) => e.source_key);
    expect(keys).toContain(`delete:${msg(1)}`);
    expect(keys).not.toContain(`create:${msg(1)}`);

    // The late create arrives after all this and is kept as a removed message, without its text.
    await push(h, human(1, { content: 'the words that were removed' }));
    const row = await one<{ content: string | null; deleted_at: string | null }>(
      h,
      'SELECT content, deleted_at FROM conversation WHERE message_id = ?',
      msg(1),
    );
    expect(row!.content).toBeNull();
    expect(row!.deleted_at).not.toBeNull();
  });

  it('keeps telling a cursor from before the pruned events that it is too old', async () => {
    const w = await world();
    const { h, agent } = w;
    await push(h, human(1), human(2), human(3));
    h.advance(40 * DAY);
    await push(h, human(4));
    await retentionJob(h.relay);
    expect(await all(h, 'SELECT 1 FROM events')).toHaveLength(2);
    const get = (path: string) => h.call('GET', path, undefined, h.as(agent.token));
    expect((await get('/v1/events?after=1')).status).toBe(410);
    expect((await get('/v1/events?after=0')).status).toBe(410);
    const problem = (await (await get('/v1/events?after=1')).json()) as { oldest_cursor: string };
    const resumed = await get(`/v1/events?after=${problem.oldest_cursor}`);
    expect(resumed.status).toBe(200);
    expect(((await resumed.json()) as { events: unknown[] }).events).toHaveLength(1);
  });

  it('leaves recent events alone', async () => {
    const w = await world();
    const { h } = w;
    await push(h, human(1), human(2));
    h.advance(29 * DAY);
    await push(h, human(3));
    expect(await retentionJob(h.relay)).toBe(0);
    expect(await all(h, 'SELECT 1 FROM events')).toHaveLength(3);
  });
});

describe('text kept in other tables', () => {
  it('blanks every text column of messages their author removed at once, of taken-down ones after a year, and of blocked, held and failed ones after 90 days', async () => {
    const w = await world();
    const { h, agent } = w;
    const make = async (hash: string, status: string, days: number, reviewedBy: string | null = null) => {
      const id = await relayMessage(h, agent.id, { content: `text ${hash}`, status, createdAt: ago(w, days), hash });
      await h.db
        .prepare("UPDATE relay_messages SET thread_name = 'a title', reply_prefix = '↪ Replying to Luna', reviewed_by = ? WHERE id = ?")
        .bind(reviewedBy, id)
        .run();
      return id;
    };
    const removed = await make('removed', 'removed', 2);
    const takenDownNew = await make('takenDownNew', 'removed', 300, 'admin');
    const takenDownOld = await make('takenDownOld', 'removed', 366, 'admin');
    const blockedOld = await make('blockedOld', 'blocked', 95);
    const blockedNew = await make('blockedNew', 'blocked', 5);
    const sent = await make('sent', 'sent', 400);
    await retentionJob(h.relay);
    const text = (id: string) => one(h, 'SELECT content, thread_name, reply_prefix FROM relay_messages WHERE id = ?', id);
    expect(await text(removed)).toEqual({ content: null, thread_name: null, reply_prefix: null });
    expect(await text(takenDownNew)).toMatchObject({ content: 'text takenDownNew', thread_name: 'a title' });
    expect(await text(takenDownOld)).toEqual({ content: null, thread_name: null, reply_prefix: null });
    expect(await text(blockedOld)).toEqual({ content: null, thread_name: null, reply_prefix: null });
    expect(await text(blockedNew)).toMatchObject({ content: 'text blockedNew', thread_name: 'a title' });
    expect(await text(sent)).toMatchObject({ content: 'text sent', thread_name: 'a title' });
  });

  it('blanks the free text of reports and appeals a year after they are resolved, and not before', async () => {
    const w = await world();
    const { h, agent } = w;
    const report = (id: string, status: string, resolvedDays: number | null) =>
      h.db
        .prepare(
          'INSERT INTO reports (id, target_type, target_id, reason, context, reporter_id, reporter_key, status, note, resolved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          id,
          'message',
          msg(1),
          'harmful',
          'some context',
          agent.id,
          agent.id,
          status,
          'a note',
          resolvedDays === null ? null : ago(w, resolvedDays),
          ago(w, 500),
        )
        .run();
    await report('rpt_old', 'dismissed', 366);
    await report('rpt_new', 'actioned', 300);
    await report('rpt_open', 'open', null);
    const appeal = (id: string, status: string, resolvedDays: number | null) =>
      h.db
        .prepare(
          'INSERT INTO appeals (id, agent_id, target_type, target_id, message, status, response, resolved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, agent.id, 'status', id, 'please look again', status, 'we did', resolvedDays === null ? null : ago(w, resolvedDays), ago(w, 500))
        .run();
    await appeal('apl_old', 'upheld', 400);
    await appeal('apl_new', 'overturned', 10);
    await appeal('apl_open', 'open', null);
    expect(await retentionJob(h.relay)).toBe(2);
    expect(await all(h, 'SELECT id, reason, context, note FROM reports ORDER BY id')).toEqual([
      { id: 'rpt_new', reason: 'harmful', context: 'some context', note: 'a note' },
      { id: 'rpt_old', reason: 'harmful', context: null, note: null },
      { id: 'rpt_open', reason: 'harmful', context: 'some context', note: 'a note' },
    ]);
    expect(await all(h, 'SELECT id, message, response FROM appeals ORDER BY id')).toEqual([
      { id: 'apl_new', message: 'please look again', response: 'we did' },
      { id: 'apl_old', message: '', response: null },
      { id: 'apl_open', message: 'please look again', response: 'we did' },
    ]);
    // Done: nothing left to blank.
    expect(await retentionJob(h.relay)).toBe(0);
  });
});

describe('the budget of a run', () => {
  it('stops at its deadline and says so, and the next run carries on', async () => {
    const w = await world();
    const { h } = w;
    for (let i = 0; i < 5; i++)
      await h.db
        .prepare(
          "INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, created_at) VALUES (?, 'system', 'x', 'test', 'test', 'x', ?)",
        )
        .bind(newId('audit'), ago(w, 400))
        .run();
    expect(await retentionJob(h.relay, { deadline: Date.now() - 1 })).toBe(0);
    expect(h.log.lines.some((l) => l.event === 'retention.out_of_budget')).toBe(true);
    expect(await retentionJob(h.relay)).toBe(5);
  });

  it('gives each rule its turn, so a big backlog in one does not starve the others', async () => {
    const w = await world();
    const { h, agent } = w;
    await push(h, human(1, { content: 'old words' }), edit(1, 'old edit', 5));
    h.advance(31 * DAY);
    await relayMessage(h, agent.id, { content: 'blocked text', status: 'blocked', createdAt: ago(w, 100), hash: 'b' });
    for (let i = 0; i < 1_100; i++)
      await h.db
        .prepare(
          "INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, created_at) VALUES (?, 'system', 'x', 'test', 'test', 'x', ?)",
        )
        .bind(newId('audit'), ago(w, 400))
        .run();
    // The audit rows, the two events' text, the old event that is pruned, and the blocked message's text.
    expect(await retentionJob(h.relay)).toBe(1_100 + 2 + 1 + 1);
  });
});

describe('every rule is served by an index', () => {
  it('reads no whole table: each statement searches an index for its candidates', async () => {
    const w = await world();
    const { h } = w;
    for (const rule of RULES) {
      const args =
        rule.name === 'events' ? ['2026-01-01T00:00:00.000Z', 5] : (rule.args?.((d) => `2026-01-${String(d % 28 || 1).padStart(2, '0')}T00:00:00.000Z`) ?? []);
      const plan = (h.db.raw.prepare(`EXPLAIN QUERY PLAN ${rule.sql}`).all(...([...args, 500] as never[])) as { detail: string }[]).map((r) => r.detail);
      expect(
        plan.filter((line) => /^SCAN (?!json)/.test(line)),
        `${rule.name}: ${plan.join(' | ')}`,
      ).toEqual([]);
    }
  });
});
