// Discord's shapes, as far as the relay and its tests look at them.
// https://docs.discord.com/developers/resources/channel · /message · /guild · /webhook · /application

export const ChannelType = {
  text: 0,
  voice: 2,
  category: 4,
  announcement: 5,
  announcementThread: 10,
  publicThread: 11,
  privateThread: 12,
  forum: 15,
  media: 16,
} as const;

export type ChannelKind = 'text' | 'announcement' | 'forum' | 'media' | 'category' | 'voice';

export const isThread = (type: number): boolean =>
  type === ChannelType.announcementThread || type === ChannelType.publicThread || type === ChannelType.privateThread;
export const isForum = (type: number): boolean => type === ChannelType.forum || type === ChannelType.media;

/** Permission bits (as BigInt: several are above bit 31). https://docs.discord.com/developers/topics/permissions */
export const Permission = {
  administrator: 1n << 3n,
  viewChannel: 1n << 10n,
  sendMessages: 1n << 11n,
  manageMessages: 1n << 13n,
  embedLinks: 1n << 14n,
  readMessageHistory: 1n << 16n,
  manageRoles: 1n << 28n,
  manageWebhooks: 1n << 29n,
  manageThreads: 1n << 34n,
  createPublicThreads: 1n << 35n,
  createPrivateThreads: 1n << 36n,
  sendMessagesInThreads: 1n << 38n,
} as const;

export const ALL_BOT_PERMISSIONS =
  Permission.viewChannel |
  Permission.sendMessages |
  Permission.manageMessages |
  Permission.readMessageHistory |
  Permission.manageRoles |
  Permission.manageWebhooks |
  Permission.manageThreads |
  Permission.createPublicThreads |
  Permission.createPrivateThreads |
  Permission.sendMessagesInThreads;

/** Gateway intents. https://docs.discord.com/developers/events/gateway#list-of-intents */
export const Intent = {
  guilds: 1 << 0,
  guildMembers: 1 << 1,
  guildPresences: 1 << 8,
  guildMessages: 1 << 9,
  messageContent: 1 << 15,
} as const;

/** Intents that exist today (bits 0 to 16, 20, 21, 24 and 25). Anything else is 4013. */
export const VALID_INTENT_MASK = 0x1ffff | (1 << 20) | (1 << 21) | (1 << 24) | (1 << 25);

/** Application flags that show a privileged intent is enabled in the Developer Portal (100+ servers, under 100). */
export const AppFlag = {
  presence: (1 << 12) | (1 << 13),
  guildMembers: (1 << 14) | (1 << 15),
  messageContent: (1 << 18) | (1 << 19),
  messageContentLimited: 1 << 19,
  messageContentFull: 1 << 18,
} as const;

export const MessageFlag = { hasThread: 1 << 5 } as const;
export const MessageType = { default: 0, threadCreated: 18, reply: 19, threadStarter: 21 } as const;

export interface User {
  id: string;
  username: string;
  discriminator: string;
  global_name: string | null;
  avatar: string | null;
  bot?: boolean;
  public_flags?: number;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  color: number;
  hoist: boolean;
  position: number;
  /** A bitfield as a decimal string. */
  permissions: string;
  managed: boolean;
  mentionable: boolean;
  flags: number;
  icon: string | null;
  unicode_emoji: string | null;
}

export interface Member {
  user: User;
  nick: string | null;
  avatar: string | null;
  roles: string[];
  joined_at: string;
  premium_since: string | null;
  deaf: boolean;
  mute: boolean;
  flags: number;
  pending: boolean;
  communication_disabled_until: string | null;
}

export interface ForumTag {
  id: string;
  name: string;
  moderated: boolean;
  emoji_id: string | null;
  emoji_name: string | null;
}

export interface ThreadMetadata {
  archived: boolean;
  auto_archive_duration: number;
  archive_timestamp: string;
  locked: boolean;
  create_timestamp: string;
}

/** A channel permission overwrite as Discord sends it: type 0 is a role, 1 a member; allow and deny are bitfields as strings. */
export interface Overwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface Channel {
  id: string;
  type: number;
  guild_id: string;
  name: string;
  position: number;
  parent_id: string | null;
  topic: string | null;
  nsfw: boolean;
  last_message_id: string | null;
  rate_limit_per_user: number;
  permission_overwrites: Overwrite[];
  flags: number;
  available_tags?: ForumTag[];
  default_auto_archive_duration?: number;
  applied_tags?: string[];
  owner_id?: string;
  thread_metadata?: ThreadMetadata & { invitable?: boolean };
  message_count?: number;
  member_count?: number;
  total_message_sent?: number;
}

export interface Webhook {
  id: string;
  type: 1;
  guild_id: string;
  channel_id: string;
  name: string;
  avatar: string | null;
  token: string;
  application_id: string | null;
}

export interface Poll {
  question: { text: string };
  answers: { answer_id: number; poll_media: { text: string } }[];
  expiry: string;
  allow_multiselect: boolean;
  layout_type: number;
  results: { is_finalized: boolean; answer_counts: { id: number; count: number; me_voted: boolean }[] };
}

export interface Message {
  id: string;
  channel_id: string;
  author: User;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  tts: boolean;
  mention_everyone: boolean;
  mentions: User[];
  mention_roles: string[];
  attachments: unknown[];
  embeds: unknown[];
  pinned: boolean;
  type: number;
  flags: number;
  components: unknown[];
  webhook_id?: string;
  application_id?: string;
  message_reference?: { type?: number; message_id?: string; channel_id?: string; guild_id?: string };
  poll?: Poll;
  thread?: Channel;
}

export interface Guild {
  id: string;
  name: string;
  owner_id: string;
  /** The role every member has. Its ID is the guild's ID. */
  everyoneRoleId: string;
  botRoleId: string;
  roles: Map<string, Role>;
  members: Map<string, Member>;
  channelIds: Set<string>;
  createdAt: string;
}

/** What the relay's DiscordRest sends for a guild command. */
export interface ApplicationCommand {
  id: string;
  application_id: string;
  guild_id: string;
  version: string;
  name: string;
  description: string;
  type: number;
  options?: unknown[];
  default_member_permissions: string | null;
  nsfw: boolean;
  integration_types: number[];
  contexts: number[];
}

export type Emit = (guildId: string, t: string, d: Record<string, unknown>) => void;

/** A refusal in Discord's error shape: `{ message, code, errors? }` with an HTTP status. */
export class DiscordHttpError extends Error {
  readonly status: number;
  readonly code: number;
  readonly errors?: unknown;
  constructor(status: number, code: number, message: string, errors?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
  body(): Record<string, unknown> {
    return { message: this.message, code: this.code, ...(this.errors === undefined ? {} : { errors: this.errors }) };
  }
}

export const errors = {
  unauthorized: () => new DiscordHttpError(401, 0, '401: Unauthorized'),
  notFound: () => new DiscordHttpError(404, 0, '404: Not Found'),
  methodNotAllowed: () => new DiscordHttpError(405, 0, '405: Method Not Allowed'),
  unknownChannel: () => new DiscordHttpError(404, 10003, 'Unknown Channel'),
  unknownGuild: () => new DiscordHttpError(404, 10004, 'Unknown Guild'),
  unknownMember: () => new DiscordHttpError(404, 10007, 'Unknown Member'),
  unknownMessage: () => new DiscordHttpError(404, 10008, 'Unknown Message'),
  unknownRole: () => new DiscordHttpError(404, 10011, 'Unknown Role'),
  unknownWebhook: () => new DiscordHttpError(404, 10015, 'Unknown Webhook'),
  unknownTag: () => new DiscordHttpError(400, 10087, 'Unknown Tag'),
  missingAccess: () => new DiscordHttpError(403, 50001, 'Missing Access'),
  missingPermissions: () => new DiscordHttpError(403, 50013, 'Missing Permissions'),
  invalidWebhookToken: () => new DiscordHttpError(401, 50027, 'Invalid Webhook Token'),
  emptyMessage: () => new DiscordHttpError(400, 50006, 'Cannot send an empty message'),
  wrongChannelType: () => new DiscordHttpError(400, 50024, 'Cannot execute action on this channel type'),
  invalidJson: () => new DiscordHttpError(400, 50109, 'The request body contains invalid JSON.'),
  forumNeedsThread: () => new DiscordHttpError(400, 220001, 'Webhooks posted to forum channels must have a thread_name or thread_id'),
  forumBothThreads: () => new DiscordHttpError(400, 220002, 'Webhooks posted to forum channels cannot have both a thread_name and thread_id'),
  threadNameOutsideForum: () => new DiscordHttpError(400, 220003, 'Webhooks can only create threads in forum channels'),
  cannotPostInForum: () => new DiscordHttpError(400, 40058, 'Cannot send a message in a forum channel'),
  threadExists: () => new DiscordHttpError(400, 160004, 'A thread has already been created for this message'),
  threadArchived: () => new DiscordHttpError(400, 50083, 'Thread is archived'),
  tooManyWebhooks: () => new DiscordHttpError(400, 30007, 'Maximum number of webhooks reached (15)'),
  invalidRecipient: () => new DiscordHttpError(400, 50033, 'Invalid Recipient(s)'),
  cannotMessageUser: () => new DiscordHttpError(403, 50007, 'Cannot send messages to this user'),
};

/** Message flag: laid out by components alone (containers, text displays); `content` and `embeds` are refused. */
export const IS_COMPONENTS_V2 = 1 << 15;

/** The bot's DM channel with one person (type 1). It belongs to no guild, and its messages reach no Gateway session. */
export interface DmChannel {
  id: string;
  type: 1;
  last_message_id: string | null;
  recipients: User[];
}

/** An emoji the application owns, usable in any message it sends. */
export interface ApplicationEmoji {
  id: string;
  name: string;
  roles: string[];
  user: User;
  require_colons: boolean;
  managed: boolean;
  animated: boolean;
  available: boolean;
}

/** `{ field: { _errors: [{ code, message }, …also] } }`, nested for a path like ['poll', 'question']. */
export function formBody(path: string[], code: string, message: string, also: { code: string; message: string }[] = []): DiscordHttpError {
  let node: Record<string, unknown> = { _errors: [{ code, message }, ...also] };
  for (const key of [...path].reverse()) node = { [key]: node };
  return new DiscordHttpError(400, 50035, 'Invalid Form Body', node);
}
