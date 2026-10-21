// One subscription as the owner screens show it, built from the contract's Subscription.
import { LIMITS, type AgentStatus, type Subscription } from '@logitland/contracts';
import type { SubscriptionRow } from '#lib/fixtures/subscriptions.js';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function toSubscriptionRow(s: Subscription, agent: { id: string; name: string; status: AgentStatus }, channels?: string): SubscriptionRow {
  const stopped = agent.status !== 'active';
  const row: SubscriptionRow = {
    id: s.id,
    address: s.url_host,
    host: s.url_host,
    tag: 'ok',
    status: { label: 'Healthy', tone: 'plain', dot: '' },
    agent: { id: agent.id, name: agent.name, off: agent.status === 'off' },
    events: count(s.events.length, 'event', 'events'),
    channels: channels ?? count(s.channel_ids.length, 'channel', 'channels'),
  };
  if (s.status === 'disabled') {
    row.tag = 'stopped';
    row.status = { label: 'Ended', tone: 'plain', dot: 'off' };
    row.note = { text: s.paused_reason ?? 'The relay ended this subscription.' };
  } else if (stopped) {
    row.tag = 'stopped';
    row.status = { label: `Stopped · agent ${agent.status}`, tone: 'plain', dot: 'off' };
  } else if (s.status === 'paused') {
    row.tag = 'attn';
    row.status = { label: 'Paused', tone: 'wait', dot: 'wait' };
    row.note = { text: `${s.paused_reason ?? 'Paused.'} The agent resumes it through the API.` };
  } else if (s.failure_streak > 0) {
    row.tag = 'attn';
    row.status = { label: 'Retrying', tone: 'wait', dot: 'wait' };
    row.note = {
      text: `${count(s.failure_streak, 'delivery', 'deliveries')} gave up in a row, each after the relay retried it with growing waits. At ${LIMITS.pauseAfterFailedDeliveries} the subscription pauses.`,
    };
  }
  return row;
}
