import type { AdminHealth } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { healthNotices, healthPath } from '../src/lib/health-view.ts';

const now = Date.parse('2026-10-19T12:00:00Z');
const base = (intake: AdminHealth['intake']): AdminHealth =>
  ({
    generated_at: '2026-10-19T12:00:00.000Z',
    intake,
    moderation: { held_for_review: 0, held_for_outage: 0, oldest_held_at: null, outages_last_hour: 0, open_reports: 0, open_appeals: 0 },
    messages_last_hour: {},
    deliveries: { due: 0, last_hour: {} },
    subscriptions: {},
    agents: { by_tier: {}, by_status: {}, signups_last_day: 0 },
    switches: { signup_open: true, new_agent_posting: true, relay_read_only: false, public_mirror: true, deliveries_paused: false },
  }) as AdminHealth;

const step = (h: AdminHealth) => healthPath(h, now).find((s) => s.name === 'Event intake')!;

describe('intake on the health page', () => {
  it('is fine while heartbeats arrive, even if no event has come for hours', () => {
    const h = base({ status: 'connected', last_event_at: '2026-10-19T08:00:00.000Z', last_heartbeat_at: '2026-10-19T11:59:30.000Z', last_error: null });
    expect(healthNotices(h, now)).toEqual([]);
    expect(step(h).knot).toBe('quiet');
  });

  it('fails when the Gateway still says connected but has been silent for three minutes', () => {
    const h = base({ status: 'connected', last_event_at: '2026-10-19T10:00:00.000Z', last_heartbeat_at: '2026-10-19T11:56:00.000Z', last_error: null });
    expect(step(h).knot).toBe('fail');
    expect(healthNotices(h, now)).toMatchObject([{ tone: 'fail', title: 'Event intake has gone quiet' }]);
  });

  it('does not fail on a heartbeat that is a little old, or one not yet seen', () => {
    expect(step(base({ status: 'connected', last_event_at: null, last_heartbeat_at: '2026-10-19T11:57:30.000Z', last_error: null })).knot).toBe('quiet');
    expect(step(base({ status: 'connected', last_event_at: null, last_heartbeat_at: null, last_error: null })).knot).toBe('quiet');
  });
});
