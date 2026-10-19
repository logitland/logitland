// The setup checklist and the Discord channel picker in fixtures mode: checks in every status, the server's
// channels with the bot's permissions, and what relaying one answers (including the refusal with its fix).
// Names, IDs and addresses are examples.
import type {
  Channel,
  ChannelAccess,
  ConsentMessage,
  DiscordChannel,
  DiscordChannelListing,
  RegisteredCommands,
  RelayChannelRequest,
  RelayChannelResult,
  SetupCheck,
} from '@logitland/contracts';
import { GUILD_ID } from './community.js';

const PORTAL = 'https://discord.com/developers/applications';

export const SETUP_CHECKS: SetupCheck[] = [
  { id: 'bot-token', title: 'The bot token works', status: 'ok', detail: 'Signed in as logitland-relay.', fix: '' },
  { id: 'bot-in-server', title: 'The bot is in the Logitland server', status: 'ok', detail: 'The bot is a member of the server.', fix: '' },
  {
    id: 'message-content-intent',
    title: 'The Message Content intent is on',
    status: 'ok',
    detail: 'Discord shows the Message Content intent is enabled, so the relay can read what people and agents write.',
    fix: '',
  },
  {
    id: 'interactions-url',
    title: 'Discord sends commands and buttons to the relay',
    status: 'fail',
    detail: 'No Interactions Endpoint URL is set, so /mirror and the agree button can’t reach the relay.',
    fix: `Open ${PORTAL} → General Information, paste https://relay.logitland.example/discord/interactions into “Interactions Endpoint URL”, and save. Discord tests it when you save, so the relay must already be deployed with DISCORD_PUBLIC_KEY set.`,
  },
  {
    id: 'mirror-command',
    title: 'The /mirror command is registered',
    status: 'fail',
    detail: 'The /mirror command isn’t registered in the server.',
    fix: 'Press “Register /mirror” on the setup page. That replaces the server’s commands for this app with the current /mirror definition.',
  },
  {
    id: 'consent-role',
    title: 'The consent role works',
    status: 'warn',
    detail: '“Agreed to the mirror” sits at or above the bot’s highest role (“Logitland relay”), so the bot can’t give it out.',
    fix: 'In Server Settings → Roles, drag the bot’s role above “Agreed to the mirror”.',
  },
  { id: 'channels-relayed', title: 'At least one channel is relayed', status: 'ok', detail: '4 channels are relayed.', fix: '' },
  { id: 'channel:110000000000000001:webhook', title: '#agent-lounge: webhook', status: 'ok', detail: 'The webhook exists and posts to this channel.', fix: '' },
  {
    id: 'channel:110000000000000001:history',
    title: '#agent-lounge: bot can read it',
    status: 'ok',
    detail: 'The bot can view the channel and read its history.',
    fix: '',
  },
  {
    id: 'channel:110000000000000001:threads',
    title: '#agent-lounge: bot can start threads',
    status: 'ok',
    detail: 'The bot can create public threads and send messages in them.',
    fix: '',
  },
  {
    id: 'channel:110000000000000001:consent',
    title: '#agent-lounge: only people who agreed can chat',
    status: 'warn',
    detail: '@everyone can send messages in #agent-lounge, so people could chat without agreeing to the public mirror.',
    fix: 'In Discord, Edit Channel → Permissions on #agent-lounge: under @everyone turn off “Send Messages” and “Send Messages in Threads” (red ✗). Add the role “Agreed to the mirror” and turn both on (green ✓).',
  },
  {
    id: 'channel:110000000000000003:webhook',
    title: '#channel-ideas: webhook',
    status: 'fail',
    detail: '#channel-ideas has no webhook, so agents can’t post.',
    fix: 'Press “Relay” for #channel-ideas on the Channels page: the bot creates the webhook itself (it needs Manage Webhooks there).',
  },
  {
    id: 'channel:110000000000000003:history',
    title: '#channel-ideas: bot can read it',
    status: 'ok',
    detail: 'The bot can view the channel and read its history.',
    fix: '',
  },
  { id: 'channel:110000000000000002:webhook', title: '#lab-bench: webhook', status: 'ok', detail: 'The webhook exists and posts to this channel.', fix: '' },
  {
    id: 'channel:110000000000000002:threads',
    title: '#lab-bench: bot can start threads',
    status: 'unknown',
    detail: 'Couldn’t check: Discord answered 429. The relay will try again on the next check.',
    fix: 'Run the checklist again in a minute.',
  },
  {
    id: 'gateway',
    title: 'The Gateway is connected',
    status: 'ok',
    detail: 'Connected. The last thing Discord sent it was at 2026-10-19 06:52 UTC (3 minutes ago).',
    fix: '',
  },
  {
    id: 'classifier',
    title: 'Messages are checked before they post',
    status: 'warn',
    detail: 'Jev/Laya isn’t configured, so only Workers AI checks messages.',
    fix: 'Set JEV_LAYA_URL and JEV_LAYA_TOKEN so Jev/Laya is the main classifier; Workers AI stays as the backup.',
  },
  { id: 'admins', title: 'At least one admin is set', status: 'ok', detail: '2 people can use the admin pages.', fix: '' },
];

const base = { guild_id: GUILD_ID };
const relayed = (id: string, name: string, type: Channel['type'], agent_access: ChannelAccess, pace: number, mirror: boolean, hook: boolean): Channel => ({
  id,
  ...base,
  name,
  type,
  agent_access,
  pace_per_agent_per_minute: pace,
  public_mirror: mirror,
  verified_only: false,
  has_webhook: hook,
});
const ready = { can_view: true, can_read_history: true, can_manage_webhooks: true, can_create_threads: true, can_send_in_threads: true };

const CATEGORY_COMMUNITY = '120000000000000001';
const CATEGORY_AGENTS = '120000000000000002';
const TAGS = [
  { id: '130000000000000001', name: 'Question', moderated: false },
  { id: '130000000000000002', name: 'Result', moderated: false },
  { id: '130000000000000003', name: 'Announcement', moderated: true },
];

function entry(
  id: string,
  name: string,
  type: DiscordChannel['type'],
  position: number,
  category: string | null,
  over: Partial<DiscordChannel> = {},
): DiscordChannel {
  return {
    id,
    name,
    type,
    type_label: { text: 'Text', announcement: 'Announcement', forum: 'Forum', media: 'Media' }[type],
    category_id: category,
    position,
    available_tags: [],
    relay: null,
    bot: ready,
    consent_enforced: false,
    ...over,
  };
}

export const DISCORD_LISTING: DiscordChannelListing = {
  guild_id: GUILD_ID,
  categories: [
    { id: CATEGORY_COMMUNITY, name: 'Community', position: 0 },
    { id: CATEGORY_AGENTS, name: 'Agents', position: 1 },
  ],
  channels: [
    entry('110000000000000007', 'welcome', 'text', 0, null, { bot: ready }),
    entry('110000000000000004', 'announcements', 'announcement', 1, CATEGORY_COMMUNITY, {
      relay: relayed('110000000000000004', 'announcements', 'announcement', 'read_only', 0, true, false),
      consent_enforced: true,
    }),
    entry('110000000000000006', 'quiet-hours', 'text', 2, CATEGORY_COMMUNITY, {
      relay: relayed('110000000000000006', 'quiet-hours', 'text', 'off', 10, false, false),
      bot: { ...ready, can_read_history: false },
    }),
    entry('110000000000000005', 'mod-room', 'text', 3, CATEGORY_COMMUNITY, {
      bot: { can_view: false, can_read_history: false, can_manage_webhooks: false, can_create_threads: false, can_send_in_threads: false },
    }),
    entry('110000000000000001', 'agent-lounge', 'text', 0, CATEGORY_AGENTS, {
      relay: relayed('110000000000000001', 'agent-lounge', 'text', 'post', 6, true, true),
    }),
    entry('110000000000000003', 'channel-ideas', 'text', 1, CATEGORY_AGENTS, {
      relay: relayed('110000000000000003', 'channel-ideas', 'text', 'post', 2, true, false),
      consent_enforced: true,
    }),
    entry('110000000000000002', 'lab-bench', 'forum', 2, CATEGORY_AGENTS, {
      relay: relayed('110000000000000002', 'lab-bench', 'forum', 'post_new_threads', 3, true, true),
      available_tags: TAGS,
      consent_enforced: true,
    }),
    entry('110000000000000009', 'help', 'forum', 3, CATEGORY_AGENTS, { available_tags: TAGS.slice(0, 2), consent_enforced: true }),
    entry('110000000000000008', 'showcase', 'media', 4, CATEGORY_AGENTS, { bot: { ...ready, can_manage_webhooks: false, can_create_threads: false } }),
  ],
};

export const COMMANDS: RegisteredCommands = { commands: [{ id: '140000000000000001', name: 'mirror', subcommands: ['agree', 'leave', 'status'] }] };

export const CONSENT_CHANNEL_TYPES = ['text', 'announcement'] as const;

export function consentMessage(channelId: string): ConsentMessage {
  return { channel_id: channelId, message_id: '150000000000000001', url: `https://discord.com/channels/${GUILD_ID}/${channelId}/150000000000000001` };
}

/** What relaying a channel answers: the result, or the refusal with the one-sentence fix Discord's permissions call for. */
export function relayFixture(
  channelId: string,
  req: RelayChannelRequest,
): { ok: true; result: RelayChannelResult } | { ok: false; status: 422; message: string } {
  const found = DISCORD_LISTING.channels.find((c) => c.id === channelId);
  if (!found)
    return {
      ok: false,
      status: 422,
      message: 'Discord won’t show that channel to the relay. Check the ID, and that the bot is in the server and can see the channel.',
    };
  if (!found.bot.can_view) return { ok: false, status: 422, message: 'Give the bot View Channel in this channel' };
  if (!found.bot.can_manage_webhooks) return { ok: false, status: 422, message: 'Give the bot Manage Webhooks in this channel' };
  const was = found.relay;
  const channel: Channel = {
    id: found.id,
    guild_id: found.relay?.guild_id ?? GUILD_ID,
    name: found.name,
    type: found.type,
    // Like the relay: a channel that is already open keeps its access; a new one starts at post, or post_new_threads in a forum or media channel.
    agent_access:
      req.agent_access ??
      (was && (was.agent_access !== 'off' || was.public_mirror)
        ? was.agent_access
        : found.type === 'forum' || found.type === 'media'
          ? 'post_new_threads'
          : 'post'),
    pace_per_agent_per_minute: req.pace_per_agent_per_minute ?? was?.pace_per_agent_per_minute ?? 10,
    public_mirror: req.public_mirror ?? was?.public_mirror ?? true,
    verified_only: req.verified_only ?? was?.verified_only ?? false,
    has_webhook: true,
  };
  return { ok: true, result: { channel, webhook_created: !was?.has_webhook, tags: found.available_tags } };
}
