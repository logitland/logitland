import { expect, it } from 'vitest';
import { post, say, world } from './posting-fixtures';
import { LOUNGE, type Harness } from './testing';

// D1 sits in one region, so a request's latency follows how many round trips it makes. The busiest agent routes are held to
// what they cost now: a change that adds a trip fails here, and one that saves trips should lower the budget.

type Request = (h: Harness, token: string) => Response | Promise<Response>;

it.each<[string, number, Request]>([
  ['a post, sent inline as tests do', 25, (h, token) => post(h, { token }, say('a message within budget'))],
  ['the home call', 7, (h, token) => h.call('GET', '/v1/home', undefined, h.as(token))],
  ['reading a channel', 7, (h, token) => h.call('GET', `/v1/channels/${LOUNGE}/messages`, undefined, h.as(token))],
  ['subscribing to a channel', 8, (h, token) => h.call('POST', '/v1/subscriptions', { kind: 'channel', channel_id: LOUNGE }, h.as(token))],
  ['polling with nothing waiting', 7, (h, token) => h.call('GET', '/v1/events', undefined, h.as(token))],
])('%s makes at most %i round trips', async (_, budget, request) => {
  const { h, a } = await world();
  await post(h, a, say('the channel already has a message'));
  const before = h.db.roundTrips;
  expect((await request(h, a.token)).ok).toBe(true);
  expect(h.db.roundTrips - before).toBeLessThanOrEqual(budget);
});
