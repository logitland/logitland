import type { DeliveryDetail, Subscription } from '@logitland/contracts';
import { LIMITS } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { toItem } from '../src/lib/server/delivery-view.ts';
import { toSubscriptionRow } from '../src/lib/subscription-view.ts';

const now = Date.parse('2026-10-19T12:00:00Z');
const detail = (over: Partial<DeliveryDetail>): DeliveryDetail => ({
  id: 'del_01M591M1W0AAAAAAAAAAAAAAAA',
  subscription_id: 'sub_01M591M1W0AAAAAAAAAAAAAAAA',
  event_id: 'evt_01M591M1W0AAAAAAAAAAAAAAAA',
  event_type: 'message.created',
  status: 'failed',
  attempts: 1,
  next_attempt_at: null,
  last_status_code: null,
  last_error: null,
  created_at: '2026-10-19T11:00:00.000Z',
  delivered_at: null,
  attempt_log: [],
  url_host: 'hooks.orrery.dev',
  agent_id: 'agt_01M591M1W0AAAAAAAAAAAAAAAA',
  agent_name: 'Orrery',
  ...over,
});

describe('why a delivery failed', () => {
  it('says the relay does not retry a 4xx, a redirect or a 410, and why', () => {
    const text = (over: Partial<DeliveryDetail>) => toItem(detail({ status: 'failed', ...over }), now).headline;
    expect(text({ last_status_code: 404, last_error: '404 from the destination' })).toContain('doesn’t retry an answer like that');
    expect(text({ last_status_code: 302, last_error: '302 redirect not followed' })).toContain('never follows redirects');
    expect(text({ last_status_code: 410, last_error: '410 Gone from the destination; the subscription was disabled' })).toContain('ended the subscription');
    expect(text({ attempts: 24, last_status_code: 503, last_error: '503 from the destination; gave up after 24 attempts' })).toContain(
      'gave up after 24 attempts',
    );
    expect(text({})).toContain(`${LIMITS.pauseAfterFailedDeliveries} failures in a row pause the subscription`);
  });
});

describe('why a delivery was dropped', () => {
  it('gives the recorded reason, or every way it can happen when none was recorded', () => {
    expect(toItem(detail({ status: 'dropped', last_error: 'The channel is no longer open to agents' }), now).headline).toBe(
      'Dropped without being sent: The channel is no longer open to agents.',
    );
    const unknown = toItem(detail({ status: 'dropped', last_error: null }), now).headline;
    for (const reason of ['paused', 'ended', 'removed', 'turned off, suspended or banned', 'messages:read', 'closes to agents', 'removed before it goes out'])
      expect(unknown).toContain(reason);
  });
});

describe('a subscription’s failures', () => {
  const sub = (over: Partial<Subscription>): Subscription => ({
    id: 'sub_01M591M1W0AAAAAAAAAAAAAAAA',
    agent_id: 'agt_01M591M1W0AAAAAAAAAAAAAAAA',
    url_host: 'hooks.orrery.dev',
    events: ['message.created'],
    channel_ids: [],
    description: null,
    status: 'active',
    paused_reason: null,
    failure_streak: 0,
    created_at: '2026-10-19T10:00:00.000Z',
    ...over,
  });
  it('counts deliveries that gave up, and says where it pauses', () => {
    const row = toSubscriptionRow(sub({ failure_streak: 3 }), { id: 'agt_x', name: 'Orrery', status: 'active' });
    expect(row.note?.text).toContain('3 deliveries gave up in a row');
    expect(row.note?.text).toContain(`At ${LIMITS.pauseAfterFailedDeliveries} the subscription pauses`);
    expect(row.note?.text).not.toContain('keeps retrying');
  });
});
