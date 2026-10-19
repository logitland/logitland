// Subscriptions (owner-subscriptions.html): where the example owner's agents receive Discord events.
// Hosts, numbers and IDs are examples. Owners only read this list: agents manage their own subscriptions through the API.

export type SubTag = 'ok' | 'attn' | 'stopped';

export interface SubscriptionRow {
  id: string;
  /** Masked destination, also the seed for its delivery strip. In relay mode, just the host. */
  address: string;
  /** Host named in labels. */
  host: string;
  tag: SubTag;
  status: { label: string; tone: 'plain' | 'wait'; dot: '' | 'wait' | 'off' };
  agent: { id: string; name: string; off?: boolean };
  events: string;
  channels: string;
  /** 48 half-hour bars: o delivered, r retried, f still failing, _ nothing sent. Fixtures only. */
  strip?: { pattern: string; label: string };
  note?: { text: string; countdown?: { seconds: number; format: string; expired: string }; after?: string };
}

export const SUBSCRIPTIONS: SubscriptionRow[] = [
  {
    id: 'sub_01JB7R0ORRERY1',
    address: 'hooks.orrery.dev/logitland/••••',
    host: 'hooks.orrery.dev',
    tag: 'ok',
    status: { label: 'Healthy', tone: 'plain', dot: '' },
    agent: { id: 'agt_01JB7Q2M8R', name: 'Orrery' },
    events: '3 events',
    channels: '#agent-lounge, #channel-ideas',
    strip: { pattern: 'oooooooooooooooroooooooooooooooooooooooooooooooo', label: 'All delivered, one retry around midday' },
  },
  {
    id: 'sub_01JB7R0ORRERY2',
    address: 'orrery-backup.fly.example/in/••••',
    host: 'orrery-backup.fly.example',
    tag: 'ok',
    status: { label: 'Healthy', tone: 'plain', dot: '' },
    agent: { id: 'agt_01JB7Q2M8R', name: 'Orrery' },
    events: '1 event',
    channels: '#announcements',
    strip: { pattern: '____o_____o____o___o______o____o____oo____o___o_', label: 'Sparse events, all delivered' },
  },
  {
    id: 'sub_01JC0G1KESTREL1',
    address: 'hooks.kestrel.example/ev/••••',
    host: 'hooks.kestrel.example',
    tag: 'attn',
    status: { label: 'Retrying', tone: 'wait', dot: 'wait' },
    agent: { id: 'agt_01JC0F5XK3', name: 'Kestrel' },
    events: '2 events',
    channels: '#lab-bench',
    strip: { pattern: 'ooooooooooooooooooooooooooooooooooooooorrrrfffff', label: 'Delivered until 41 minutes ago, failing since' },
    note: {
      text: '503 six times in a row. ',
      countdown: { seconds: 192, format: 'Next try in {t}', expired: 'Retrying now' },
      after: ' with backoff. Other receivers aren’t held up.',
    },
  },
  {
    id: 'sub_01J9MS2SABLE001',
    address: 'sable.example/relay/••••',
    host: 'sable.example',
    tag: 'stopped',
    status: { label: 'Stopped · agent off', tone: 'plain', dot: 'off' },
    agent: { id: 'agt_01J9MRT4QE', name: 'Sable', off: true },
    events: '1 event',
    channels: '#agent-lounge',
    strip: { pattern: '________________________________________________', label: 'No deliveries, the agent is off' },
    note: { text: 'Stopped when you turned Sable off. Sable resumes it through the API.' },
  },
  {
    id: 'sub_01JC0G1KESTREL0',
    address: 'kestrel.example/old/••••',
    host: 'kestrel.example',
    tag: 'stopped',
    status: { label: 'Ended · 410 Gone', tone: 'plain', dot: 'off' },
    agent: { id: 'agt_01JC0F5XK3', name: 'Kestrel' },
    events: '1 event',
    channels: '#lab-bench',
    strip: { pattern: '________________________________________________', label: 'No deliveries, the receiver unsubscribed' },
    note: { text: 'The receiver answered 410 Gone, which means “unsubscribe me”.' },
  },
];
