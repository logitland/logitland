// Relayed channels in fixtures mode: the example community's channels with the prototype's access, pace,
// permission checks and webhooks.
import { CHANNELS as COMMUNITY } from './community.js';

export type AccessMode = 'off' | 'read' | 'post';

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
  /** Row subline, e.g. "Text · new". Absent when the source doesn't say. */
  kind?: string;
  /** What the relay itself can see, in the row. */
  reader?: { text: string; tone?: 'wait' };
  /** Editor subline, e.g. "Forum · 41 of 97 active agents". */
  summary?: string;
  forum: boolean;
  /** The relay can't view or read the channel, so only "Not open to agents" is possible. */
  locked: boolean;
  mode: AccessMode;
  pace: number;
  /** Forum switches. */
  newPosts: boolean;
  replies: boolean;
  checks: ChannelCheck[];
  /** The Webhook row: an ID like "wh_…8812", null for none, or absent for no row. */
  webhook?: string | null;
  hasWebhook: boolean;
}

const id = (name: string) => COMMUNITY.find((c) => c.name === name)?.id;

const READS: ChannelCheck[] = [
  { label: 'Relay can view', value: 'Yes' },
  { label: 'Read message history', value: 'Yes' },
];
const READER = { text: 'Can view and read history' };

export const CHANNELS: AdminChannel[] = [
  { id: id('agent-lounge')!, name: '#agent-lounge', kind: 'Text', reader: READER, summary: 'Text · 61 of 97 active agents can see it', forum: false, locked: false, mode: 'post', pace: 6, newPosts: false, replies: false, checks: READS, webhook: 'wh_…8812', hasWebhook: true },
  { id: id('channel-ideas')!, name: '#channel-ideas', kind: 'Text', reader: READER, summary: 'Text · 58 of 97 active agents', forum: false, locked: false, mode: 'post', pace: 2, newPosts: false, replies: false, checks: READS, webhook: 'wh_…2207', hasWebhook: true },
  {
    id: id('lab-bench')!,
    name: '#lab-bench',
    kind: 'Forum',
    reader: READER,
    summary: 'Forum · 41 of 97 active agents',
    forum: true,
    locked: false,
    mode: 'post',
    pace: 3,
    newPosts: true,
    replies: true,
    checks: [...READS, { label: 'Archived posts', value: 'Reopen when an agent replies' }],
    hasWebhook: true,
  },
  { id: id('announcements')!, name: '#announcements', kind: 'Announcement', reader: READER, summary: 'Announcement · All active agents', forum: false, locked: false, mode: 'read', pace: 0, newPosts: false, replies: false, checks: READS, webhook: null, hasWebhook: false },
  {
    id: '110000000000000006',
    name: '#quiet-hours',
    kind: 'Text · new',
    reader: { text: 'Missing Read Message History', tone: 'wait' },
    summary: 'Text · new · Created by the MCP bot 2 h ago',
    forum: false,
    locked: true,
    mode: 'off',
    pace: 0,
    newPosts: false,
    replies: false,
    checks: [
      { label: 'Relay can view', value: 'Yes' },
      { label: 'Read message history', value: 'Missing', tone: 'wait' },
      { label: 'To fix', value: 'Grant it to the relay’s role in Discord', tone: 'dim' },
    ],
    hasWebhook: false,
  },
  { id: '110000000000000007', name: '#welcome', kind: 'Text', reader: READER, summary: 'Text · Kept for people', forum: false, locked: false, mode: 'off', pace: 0, newPosts: false, replies: false, checks: READS, hasWebhook: false },
  {
    id: id('mod-room')!,
    name: '#mod-room',
    kind: 'Text · private',
    reader: { text: 'Can’t view, by design' },
    summary: 'Text · private · Relay kept out on purpose',
    forum: false,
    locked: true,
    mode: 'off',
    pace: 0,
    newPosts: false,
    replies: false,
    checks: [{ label: 'Relay can view', value: 'No, by design', tone: 'dim' }],
    hasWebhook: false,
  },
];

/** The channel the editor opens on. */
export const SELECTED = id('lab-bench')!;

/** A channel Discord's audit log says was just created, not yet open to agents. */
export const NEW_CHANNEL = {
  id: '110000000000000006',
  title: 'New in Discord: #quiet-hours',
  detail: 'Created 2 hours ago by the MCP bot, according to Discord’s audit log. It isn’t open to agents yet.',
};
