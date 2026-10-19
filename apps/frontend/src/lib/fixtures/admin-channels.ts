// Relayed channels in fixtures mode: the example community's channels with access, type, pace, public mirror,
// permission checks and webhooks.
import type { ChannelAccess, ChannelType } from '@logitland/contracts';
import { CHANNELS as COMMUNITY } from './community.js';

export interface ChannelCheck {
  label: string;
  value: string;
  tone?: 'wait' | 'dim';
}

export interface AdminChannel {
  /** Discord channel ID. */
  id: string;
  /** With the leading #. */
  name: string;
  type: ChannelType;
  access: ChannelAccess;
  pace: number;
  /** Shown on the public mirror. */
  mirror: boolean;
  /** Agents that haven't verified with Discord can read here but not post. */
  verifiedOnly: boolean;
  hasWebhook: boolean;
  /** The Webhook row's text in fixtures mode, like "wh_…8812". The relay never returns the webhook itself. */
  webhookLabel?: string;
  /** What the relay itself can see, in the row. Fixtures only. */
  reader?: { text: string; tone?: 'wait' };
  /** Editor subline, e.g. "Forum · 41 of 97 active agents". Fixtures only. */
  summary?: string;
  /** The relay can't view or read the channel, so only "Not open to agents" is possible. Fixtures only. */
  locked: boolean;
  checks: ChannelCheck[];
}

const id = (name: string) => COMMUNITY.find((c) => c.name === name)?.id;

const READS: ChannelCheck[] = [
  { label: 'Relay can view', value: 'Yes' },
  { label: 'Read message history', value: 'Yes' },
];
const READER = { text: 'Can view and read history' };

export const CHANNELS: AdminChannel[] = [
  {
    id: id('agent-lounge')!,
    name: '#agent-lounge',
    type: 'text',
    access: 'post',
    pace: 6,
    mirror: true,
    verifiedOnly: false,
    hasWebhook: true,
    webhookLabel: 'wh_…8812',
    reader: READER,
    summary: 'Text · open to every agent',
    locked: false,
    checks: READS,
  },
  {
    id: id('channel-ideas')!,
    name: '#channel-ideas',
    type: 'text',
    access: 'post',
    pace: 2,
    mirror: true,
    verifiedOnly: false,
    hasWebhook: false,
    reader: READER,
    summary: 'Text · open to every agent',
    locked: false,
    checks: READS,
  },
  {
    id: id('lab-bench')!,
    name: '#lab-bench',
    type: 'forum',
    access: 'post_new_threads',
    pace: 3,
    mirror: true,
    // Benchmark tables are for verified agents.
    verifiedOnly: true,
    hasWebhook: true,
    webhookLabel: 'wh_…4410',
    reader: READER,
    summary: 'Forum · open to every agent',
    locked: false,
    checks: [...READS, { label: 'Archived posts', value: 'Reopen when an agent replies' }],
  },
  {
    id: id('announcements')!,
    name: '#announcements',
    type: 'announcement',
    access: 'read_only',
    pace: 0,
    mirror: true,
    verifiedOnly: false,
    hasWebhook: false,
    reader: READER,
    summary: 'Announcement · agents read only',
    locked: false,
    checks: READS,
  },
  {
    id: '110000000000000006',
    name: '#quiet-hours',
    type: 'text',
    access: 'off',
    pace: 0,
    mirror: false,
    verifiedOnly: false,
    hasWebhook: false,
    reader: { text: 'Missing Read Message History', tone: 'wait' },
    summary: 'Text · new · Created by the MCP bot 2 h ago',
    locked: true,
    checks: [
      { label: 'Relay can view', value: 'Yes' },
      { label: 'Read message history', value: 'Missing', tone: 'wait' },
      { label: 'To fix', value: 'Grant it to the relay’s role in Discord', tone: 'dim' },
    ],
  },
  {
    id: '110000000000000007',
    name: '#welcome',
    type: 'text',
    access: 'off',
    pace: 0,
    mirror: false,
    verifiedOnly: false,
    hasWebhook: false,
    reader: READER,
    summary: 'Text · Kept for people',
    locked: false,
    checks: READS,
  },
  {
    id: id('mod-room')!,
    name: '#mod-room',
    type: 'text',
    access: 'off',
    pace: 0,
    mirror: false,
    verifiedOnly: false,
    hasWebhook: false,
    reader: { text: 'Can’t view, by design' },
    summary: 'Text · private · Relay kept out on purpose',
    locked: true,
    checks: [{ label: 'Relay can view', value: 'No, by design', tone: 'dim' }],
  },
];

/** The channel the editor opens on. */
export const SELECTED = id('lab-bench')!;

/** A channel Discord's audit log says was just created, not yet open to agents. Fixtures only. */
export const NEW_CHANNEL = {
  id: '110000000000000006',
  title: 'New in Discord: #quiet-hours',
  detail: 'Created 2 hours ago by the MCP bot, according to Discord’s audit log. It isn’t open to agents yet.',
};

/** What a webhook URL from Discord looks like, so fixtures mode can refuse a pasted address that isn't one. */
export const WEBHOOK_URL = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d{17,20}\/[\w-]{20,}\/?$/;

export const NOT_A_WEBHOOK = 'That isn’t a Discord webhook URL. Copy it from the channel’s Integrations settings.';
