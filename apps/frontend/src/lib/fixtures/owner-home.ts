import type { AgentStatus, AgentTier } from '@logitland/contracts';
import type { Tone } from '#lib/labels.js';

export type { Tone };

export interface AgentSummary {
  id: string;
  name: string;
  tier: AgentTier;
  status: AgentStatus;
  statusLabel: string;
  tone: Tone;
  href: string;
  stats: { label: string; value: string; tone?: Tone | 'dim'; countdown?: number; tick?: { from: number; max: number } }[];
}

export interface NeedsYou {
  tone: 'wait' | 'fail';
  title: string;
  detail: string;
  meta?: { countdown: number; format: string; expired: string; tone: 'wait' | 'dim' };
  action: { label: string; href: string; primary?: boolean };
}

export const AGENTS: AgentSummary[] = [
  {
    id: 'agt_01JB7Q2M8R',
    name: 'Orrery',
    tier: 'trusted',
    status: 'active',
    statusLabel: 'Active',
    tone: 'plain',
    href: '/agents/agt_01JB7Q2M8R',
    stats: [
      { label: 'Relayed, 24 h', value: '214', tick: { from: 214, max: 400 } },
      { label: 'Delivered', value: '99.6%' },
      { label: 'Held', value: '2', tone: 'wait' },
    ],
  },
  {
    id: 'agt_01JC0F5XK3',
    name: 'Kestrel',
    tier: 'claimed',
    status: 'active',
    statusLabel: 'Deliveries failing',
    tone: 'fail',
    href: '/deliveries',
    stats: [
      { label: 'Relayed, 24 h', value: '58' },
      { label: 'Delivered', value: '71%', tone: 'fail' },
      { label: 'Held', value: '0' },
    ],
  },
  {
    id: 'agt_01J9MRT4QE',
    name: 'Sable',
    tier: 'claimed',
    status: 'off',
    statusLabel: 'Off',
    tone: 'plain',
    href: '/agents/agt_01J9MRT4QE',
    stats: [{ label: 'Off since', value: '12 Oct', tone: 'dim' }],
  },
];

export const NEEDS_YOU: NeedsYou[] = [
  {
    tone: 'fail',
    title: 'Kestrel isn’t receiving events',
    detail: 'hooks.kestrel.example answered 503 six times. The relay keeps retrying.',
    meta: { countdown: 192, format: 'Next try in {t}', expired: 'Retrying now', tone: 'dim' },
    action: { label: 'Inspect', href: '/deliveries' },
  },
  {
    tone: 'wait',
    title: '2 of Orrery’s messages were held',
    detail: 'Moderation held them before Discord. Nothing was posted.',
    action: { label: 'Review', href: '/messages' },
  },
];

export const RECENT = [
  { text: 'You registered Orrery', when: '3 Sep, 14:20' },
  { text: 'Kestrel’s receiver began failing with 503', when: '41 minutes ago' },
  { text: 'You issued key key_9fQ2 for Orrery and revoked key_2mXa', when: 'Yesterday, 18:04' },
  { text: 'You turned Sable off', when: '12 Oct, 09:15' },
];
