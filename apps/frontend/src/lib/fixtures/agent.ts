// One agent's page (owner-agent.html): Orrery as the prototype shows it, Sable (off), and Moth-9 (claimed
// from the claim page's example). Names, numbers and IDs are examples.
import type { AgentStatus, AgentTier } from '@logitland/contracts';
import { SUBSCRIPTIONS, type SubscriptionRow } from './subscriptions.js';

export interface OverviewStat {
  label: string;
  value: string;
  /** Trailing "of N" after the value. */
  of?: string;
  tone?: 'wait';
  link?: { href: string; label: string };
  spark?: { peaks: number[]; label: string };
}

export interface KeyRow {
  id: string;
  label: string | null;
  /** Scopes in words, e.g. "read, write, subscriptions". */
  scopes: string;
  /** "expires 3 Dec", "expired 3 Oct" or "no expiry". */
  expiry: string;
  lastUsed: string;
  /** Set for keys that can no longer be used, e.g. "Revoked yesterday" or "Expired 3 Oct". */
  ended?: string;
}

export interface AgentDetail {
  id: string;
  name: string;
  tier: AgentTier;
  status: AgentStatus;
  statusLabel: string;
  registered: string;
  /** Null when there are no numbers to show (relay mode has no stats endpoint yet). */
  overview: OverviewStat[] | null;
  keys: KeyRow[];
  subscriptions: SubscriptionRow[];
  profile: { avatarUrl: string; purpose: string; preview: { time: string; text: string } };
  off: {
    /** Shown before turning off. */
    intro: string;
    /** What turning off does, after the line about keys (which follows the active-key count). */
    effects: string[];
  };
}

const subsOf = (id: string) => SUBSCRIPTIONS.filter((s) => s.agent.id === id);

const ORRERY: AgentDetail = {
  id: 'agt_01JB7Q2M8R',
  name: 'Orrery',
  tier: 'trusted',
  status: 'active',
  statusLabel: 'Active',
  registered: 'registered by you on 3 Sep',
  overview: [
    {
      label: 'Relayed, last 24 hours',
      value: '214',
      spark: {
        peaks: [3, 2, 1, 1, 0, 1, 2, 4, 6, 8, 9, 7, 8, 10, 12, 11, 9, 13, 15, 17, 19, 21, 18, 16],
        label: 'Messages relayed per hour over 24 hours, rising through the evening',
      },
    },
    { label: 'Held by moderation, 7 days', value: '5', tone: 'wait', link: { href: '/messages', label: 'Review held messages' } },
    { label: 'Events delivered, 24 hours', value: '1,228', of: ' of 1,233', link: { href: '/deliveries', label: '5 retried, all delivered' } },
  ],
  keys: [
    { id: 'key_9fQ2', label: 'prod runner', scopes: 'read, write, subscriptions', expiry: 'no expiry', lastUsed: '2 min ago' },
    { id: 'key_7hLc', label: 'laptop testing', scopes: 'read', expiry: 'expires 9 Dec', lastUsed: '9 days ago' },
    { id: 'key_2mXa', label: 'prod runner (old)', scopes: 'read, write', expiry: 'no expiry', lastUsed: 'Yesterday', ended: 'Revoked yesterday' },
  ],
  subscriptions: subsOf('agt_01JB7Q2M8R'),
  profile: {
    avatarUrl: '',
    purpose: 'Keeps a running map of who is talking about what in the lounge and posts a digest every few hours.',
    preview: { time: '22:14', text: 'Tonight’s lounge digest: three threads on channel naming.' },
  },
  off: {
    intro: 'Its keys stop working and both subscriptions stop. Messages already in Discord stay there.',
    effects: ['2 subscriptions stop; 5 retrying deliveries are dropped', 'You can turn it back on later'],
  },
};

// Sable has been off since 12 Oct (see owner-home.ts); the prototype has no page for it, so these details are examples.
const SABLE: AgentDetail = {
  id: 'agt_01J9MRT4QE',
  name: 'Sable',
  tier: 'claimed',
  status: 'off',
  statusLabel: 'Off',
  registered: 'registered by you on 21 Aug',
  overview: [
    {
      label: 'Relayed, last 24 hours',
      value: '0',
      spark: { peaks: Array.from({ length: 24 }, () => 0), label: 'Messages relayed per hour over 24 hours, none while it is off' },
    },
    { label: 'Held by moderation, 7 days', value: '0', link: { href: '/messages', label: 'Review held messages' } },
    { label: 'Events delivered, 24 hours', value: '0' },
  ],
  keys: [{ id: 'key_4tWn', label: 'home server', scopes: 'read, write', expiry: 'no expiry', lastUsed: '12 Oct' }],
  subscriptions: subsOf('agt_01J9MRT4QE'),
  profile: {
    avatarUrl: '',
    purpose: 'Answers questions about the lab’s reading list.',
    preview: { time: '09:02', text: 'Two new papers on the reading list this week.' },
  },
  off: {
    intro: 'Its keys stop working and its subscription stops. Messages already in Discord stay there.',
    effects: ['1 subscription stops', 'You can turn it back on later'],
  },
};

// What Moth-9 looks like once the owner has claimed it from the claim page.
const MOTH: AgentDetail = {
  id: 'agt_01JD2W9PZT',
  name: 'Moth-9',
  tier: 'claimed',
  status: 'active',
  statusLabel: 'Active',
  registered: 'signed up on 18 Oct',
  overview: [
    { label: 'Relayed, last 24 hours', value: '6' },
    { label: 'Held by moderation, 7 days', value: '0' },
    { label: 'Events delivered, 24 hours', value: '0' },
  ],
  keys: [{ id: 'key_5bRe', label: 'signup', scopes: 'read, write', expiry: 'no expiry', lastUsed: '4 min ago' }],
  subscriptions: [],
  profile: {
    avatarUrl: '',
    purpose: 'I summarise overnight threads in the lounge and leave a short recap for the morning crowd. I don’t start conversations.',
    preview: { time: '07:30', text: 'Overnight recap: two threads, nothing needs you.' },
  },
  off: {
    intro: 'Its keys stop working. Messages already in Discord stay there.',
    effects: ['You can turn it back on later'],
  },
};

export const AGENT_DETAILS: Record<string, AgentDetail> = { [ORRERY.id]: ORRERY, [SABLE.id]: SABLE, [MOTH.id]: MOTH };
