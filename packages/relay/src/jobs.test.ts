import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleScheduled } from './jobs';
import { sweepCountersJob } from './services/limits';
import { harness } from './testing';

afterEach(() => vi.useRealTimers());

describe('which jobs run', () => {
  it('decides the quarter-hour jobs from the scheduled time, not from when the run started', async () => {
    const late = harness({ start: '2026-10-19T03:16:30Z' });
    // The run for 03:15 started a minute and a half late: it is still the quarter-hour run.
    const out = await handleScheduled(late.relay, new Date('2026-10-19T03:15:00Z'));
    expect(Object.keys(out)).toEqual(expect.arrayContaining(['retention', 'raw-ips', 'origins', 'counters', 'reseal']));

    const early = harness({ start: '2026-10-19T03:15:02Z' });
    // The relay's clock says 03:15 but the trigger was scheduled for 03:07.
    const minute = await handleScheduled(early.relay, Date.UTC(2026, 9, 19, 3, 7));
    expect(Object.keys(minute)).toEqual(['gateway', 'held', 'stuck', 'deliveries', 'streams', 'consent', 'roles', 'alerts']);
  });

  it('falls back to the relay’s clock without a scheduled time', async () => {
    const h = harness({ start: '2026-10-19T03:30:00Z' });
    expect(await handleScheduled(h.relay)).toHaveProperty('retention');
    const other = harness({ start: '2026-10-19T03:31:00Z' });
    expect(await handleScheduled(other.relay)).not.toHaveProperty('retention');
  });
});

describe('a job’s time budget', () => {
  it('moves on from a job that hangs, says so, and runs the rest', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const h = harness({ gateway: { ensure: () => new Promise<void>(() => {}), status: async () => ({}) } });
    const running = handleScheduled(h.relay);
    await vi.advanceTimersByTimeAsync(10_001);
    const out = await running;
    expect(out.gateway).toBe('timed_out');
    expect(out.held).toBe(0);
    expect(out.deliveries).toBe(0);
    expect(h.log.lines.some((l) => l.event === 'cron.job_timed_out' && l.fields.job === 'gateway')).toBe(true);
  });

  it('records a job that fails after it was given up on, without an unhandled rejection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let fail!: (e: Error) => void;
    const h = harness({ gateway: { ensure: () => new Promise<void>((_, reject) => (fail = reject)), status: async () => ({}) } });
    const running = handleScheduled(h.relay);
    await vi.advanceTimersByTimeAsync(10_001);
    await running;
    fail(new Error('late failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.log.lines.some((l) => l.event === 'cron.job_failed' && l.fields.job === 'gateway')).toBe(true);
  });
});

describe('the counter sweep', () => {
  it('clears old windows a bounded batch at a time, and stops at its deadline', async () => {
    const h = harness();
    const old = Math.floor(h.relay.now().getTime() / 1000) - 3 * 86_400;
    for (let i = 0; i < 2_500; i += 500)
      await h.db.batch(
        Array.from({ length: 500 }, (_, j) => h.db.prepare('INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, 1)').bind(`k${i + j}`, old)),
      );
    await h.db
      .prepare('INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, 1)')
      .bind('fresh', Math.floor(h.relay.now().getTime() / 1000))
      .run();
    expect(await sweepCountersJob(h.relay, { deadline: Date.now() - 1 })).toBe(1_000);
    expect(await sweepCountersJob(h.relay)).toBe(1_500);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM rate_counters').first()).toEqual({ n: 1 });
  });
});
