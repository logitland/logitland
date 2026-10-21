import { describe, expect, it, vi } from 'vitest';
import { all, deliveryCount, edit, human, msg, one, push, remove, subscribe, world } from './intake-fixtures';
import { fanOut } from './services/deliveries';
import { refanJob } from './services/events';
import { recordAgentPost, recordGap } from './services/intake';
import { LOUNGE } from './testing';

// fanOut is B5's. Here it is the real one, except that a test can make it fail.
vi.mock('./services/deliveries', async (original) => {
  const real = await original<typeof import('./services/deliveries')>();
  return { ...real, fanOut: vi.fn(real.fanOut) };
});

const unfanned = async (h: Awaited<ReturnType<typeof world>>['h']) =>
  (await all<{ type: string }>(h, 'SELECT type FROM events WHERE fanned_out_at IS NULL ORDER BY seq')).map((e) => e.type);

describe('events whose fan-out failed', () => {
  it('stay in the log, wait a minute, and are fanned out by the refan job', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    vi.mocked(fanOut).mockRejectedValueOnce(new Error('the queue is down'));
    const r = await push(h, human(1), human(2));
    expect(r).toMatchObject({ recorded: 2, deliveries: 1 });
    expect(await unfanned(h)).toEqual(['message.created']);
    expect(await deliveryCount(h)).toBe(1);
    expect(h.log.lines.some((l) => l.event === 'intake.fan_out_failed')).toBe(true);

    // Too soon: the first attempt may still be running.
    expect(await refanJob(h.relay)).toBe(0);
    h.advance(61_000);
    expect(await refanJob(h.relay)).toBe(1);
    expect(await unfanned(h)).toEqual([]);
    expect(await deliveryCount(h)).toBe(2);
    expect(await all(h, 'SELECT DISTINCT event_id FROM deliveries')).toHaveLength(2);
    expect(h.log.lines.some((l) => l.event === 'intake.refanned' && l.fields.events === 1 && l.fields.deliveries === 1)).toBe(true);
  });

  it('are refanned once: a second run finds nothing and makes no more deliveries', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    vi.mocked(fanOut).mockRejectedValueOnce(new Error('down'));
    await push(h, human(1));
    h.advance(61_000);
    expect(await refanJob(h.relay)).toBe(1);
    expect(await refanJob(h.relay)).toBe(0);
    expect(await deliveryCount(h)).toBe(1);
  });

  it('are refanned safely when the first attempt did part of the work: no duplicate deliveries', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, human(1));
    expect(await deliveryCount(h)).toBe(1);
    // The delivery exists but nothing recorded that: for example, marking the event failed.
    await h.db.prepare('UPDATE events SET fanned_out_at = NULL').run();
    h.advance(61_000);
    expect(await refanJob(h.relay)).toBe(1);
    expect(await deliveryCount(h)).toBe(1);
    expect(await unfanned(h)).toEqual([]);
  });

  it('keep waiting while fan-out keeps failing, without making the job fail', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    vi.mocked(fanOut).mockRejectedValue(new Error('still down'));
    try {
      await push(h, human(1));
      h.advance(61_000);
      expect(await refanJob(h.relay)).toBe(1);
      expect(await unfanned(h)).toEqual(['message.created']);
      expect(await deliveryCount(h)).toBe(0);
    } finally {
      vi.mocked(fanOut).mockReset();
      vi.mocked(fanOut).mockImplementation((await vi.importActual<typeof import('./services/deliveries')>('./services/deliveries')).fanOut);
    }
    h.advance(61_000);
    expect(await refanJob(h.relay)).toBe(1);
    expect(await deliveryCount(h)).toBe(1);
  });

  it('are handled a bounded number at a time, oldest first', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    vi.mocked(fanOut).mockRejectedValue(new Error('down'));
    try {
      await push(h, ...Array.from({ length: 120 }, (_, i) => human(i + 1)));
    } finally {
      vi.mocked(fanOut).mockReset();
      vi.mocked(fanOut).mockImplementation((await vi.importActual<typeof import('./services/deliveries')>('./services/deliveries')).fanOut);
    }
    expect(await unfanned(h)).toHaveLength(120);
    h.advance(61_000);
    expect(await refanJob(h.relay)).toBe(50);
    expect(await refanJob(h.relay)).toBe(50);
    expect(await refanJob(h.relay)).toBe(20);
    expect(await refanJob(h.relay)).toBe(0);
    expect(await deliveryCount(h)).toBe(120);
  });

  it('include removals, agent posts and gap events', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    vi.mocked(fanOut).mockRejectedValue(new Error('down'));
    try {
      await push(h, human(1), remove(1));
      await recordAgentPost(h.relay, {
        discordMessageId: msg(2),
        channelId: LOUNGE,
        threadId: null,
        agentId: agent.id,
        displayName: 'Moth-9',
        content: 'hi',
        relayMessageId: 'msg_01JB7Q2M8R',
        createdAt: '2026-10-19T03:00:02Z',
      });
      await recordGap(h.relay, { channelIds: [LOUNGE], windowStart: '2026-10-19T02:00:00Z', windowEnd: '2026-10-19T02:05:00Z', reason: 'x' });
    } finally {
      vi.mocked(fanOut).mockReset();
      vi.mocked(fanOut).mockImplementation((await vi.importActual<typeof import('./services/deliveries')>('./services/deliveries')).fanOut);
    }
    expect(await unfanned(h)).toEqual(['message.created', 'message.deleted', 'message.created', 'subscription.gap']);
    h.advance(61_000);
    expect(await refanJob(h.relay)).toBe(4);
    expect(await all<{ event_type: string }>(h, 'SELECT event_type FROM deliveries ORDER BY event_type')).toHaveLength(4);
    // The gap event carries its resume cursor.
    const gap = await one<{ payload: string; seq: number }>(h, "SELECT payload, seq FROM events WHERE type = 'subscription.gap'");
    expect(JSON.parse(gap!.payload).data.resume_cursor).toBe(String(gap!.seq));
  });
});

describe('events nobody needs telling about', () => {
  it('are born fanned out, so the refan job leaves them alone', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    // An edit to a message the relay never saw, and the removal of one it never saw, are logged without a fan-out.
    await push(h, edit(7, 'who knows', 5), remove(8));
    expect(await unfanned(h)).toEqual([]);
    h.advance(61_000);
    expect(await refanJob(h.relay)).toBe(0);
    expect(await deliveryCount(h)).toBe(0);
  });

  it('and events fanned out normally are marked when it works', async () => {
    const { h, agent } = await world();
    await subscribe(h, agent.id);
    await push(h, human(1));
    expect(await unfanned(h)).toEqual([]);
    expect((await one<{ fanned_out_at: string }>(h, 'SELECT fanned_out_at FROM events'))!.fanned_out_at).toBe(h.now().toISOString());
  });

  it('even when nobody subscribes', async () => {
    const { h } = await world();
    await push(h, human(1));
    expect(await unfanned(h)).toEqual([]);
  });
});
