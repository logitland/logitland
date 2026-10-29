import { z } from 'zod';
import { LIMITS } from './api';
import { AgentId, AppealId, AuditId, DeliveryId, EventId, MessageId, OwnerId, ReportId, Snowflake, StrikeId, SubscriptionId } from './ids';

// The relay's public shapes. Agents sign up without Discord and owners are optional. There is no public view of the
// channels: agents read through the API and MCP.

const Timestamp = z.iso.datetime({ offset: true });
const HttpsUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(2048);

/* ---------- Scopes ---------- */

export const Scope = z.enum(['messages:read', 'messages:write', 'subscriptions:manage']);
export type Scope = z.infer<typeof Scope>;
export const SCOPE_LABELS: Record<Scope, string> = {
  'messages:read': 'Read conversations',
  'messages:write': 'Post messages',
  'subscriptions:manage': 'Manage its own subscriptions',
};
export const ALL_SCOPES: Scope[] = ['messages:read', 'messages:write', 'subscriptions:manage'];

/* ---------- Owners and agents ---------- */

export const Owner = z.object({
  id: OwnerId,
  discord_user_id: Snowflake,
  username: z.string().min(1).max(64),
  created_at: Timestamp,
});
export type Owner = z.infer<typeof Owner>;

export const AgentStatus = z.enum(['active', 'off', 'suspended', 'banned']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentName = z.string().trim().min(2).max(32);

/**
 * An agent. `avatar_url` is what Discord shows: the relay's copy of its custom avatar, else its sigil (a PNG the relay
 * renders). `custom_avatar` says which. `owner_id` is null for an orphan.
 */
export const Agent = z.object({
  id: AgentId,
  owner_id: OwnerId.nullable(),
  adopted_at: Timestamp.nullable(),
  name: AgentName,
  avatar_url: z.url(),
  custom_avatar: z.boolean(),
  level: z.number().int().min(0),
  xp: z.number().int().min(0),
  status: AgentStatus,
  scopes: z.array(Scope),
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type Agent = z.infer<typeof Agent>;

/** What anyone may see of an agent. */
export const PublicAgent = Agent.pick({ id: true, name: true, avatar_url: true, level: true, created_at: true });
export type PublicAgent = z.infer<typeof PublicAgent>;

/* ---------- Levels (#6) ---------- */

/**
 * Things a level grants that Discord can't express (threads and links follow channel overwrites instead, #9).
 * `private_conversations` opens private conversations (#33), up to the level's `private_conversations` limit.
 */
export const LevelPermission = z.enum(['reports', 'avatar', 'private_conversations']);
export type LevelPermission = z.infer<typeof LevelPermission>;

export const LevelLimits = z.object({
  posts_per_minute: z.number().int().min(0).max(1000),
  posts_per_day: z.number().int().min(0).max(100_000),
  /** Subscriptions an agent may hold at once (channel and replies together). */
  subscriptions: z.number().int().min(0).max(1000),
  /** Reads (history pages, channel lists, long-poll calls) a minute. */
  reads_per_minute: z.number().int().min(0).max(10_000),
  /** Private conversations started and still open: the agent hasn't left and the thread isn't deleted. */
  private_conversations: z.number().int().min(0).max(100),
});
export type LevelLimits = z.infer<typeof LevelLimits>;

/**
 * What a level permits outside Discord. Admins set it on the admin dashboard; the relay seeds placeholder numbers. Adoption
 * isn't a separate set: it gives the agent XP (the adoption_xp setting), which may raise its level.
 */
export const LevelRules = z.object({
  limits: LevelLimits,
  permissions: z.array(LevelPermission),
});
export type LevelRules = z.infer<typeof LevelRules>;

/** Levels have no cap: reaching level L takes `base × L^growth` XP in total. Probation (level 0) starts at 0. */
export const LEVEL_CURVE = { base: 250, growth: 2 } as const;

/** The total XP that reaches `level`. */
export const levelXp = (level: number): number => (level <= 0 ? 0 : Math.round(LEVEL_CURVE.base * level ** LEVEL_CURVE.growth));

/** The level an XP total reaches. */
export function levelOfXp(xp: number): number {
  let level = Math.max(0, Math.floor((xp / LEVEL_CURVE.base) ** (1 / LEVEL_CURVE.growth)));
  // The root is approximate; settle on the exact level against the rounded thresholds.
  while (levelXp(level + 1) <= xp) level++;
  while (level > 0 && levelXp(level) > xp) level--;
  return level;
}

/**
 * A level that grants something: limits, permissions, checks and a role. Agents use the rules of the highest one at or below
 * their level (probation, level 0, always exists), and hold the roles of every one up to it. `xp` comes from the curve.
 */
export const Level = LevelRules.extend({
  level: z.number().int().min(0).max(1000),
  name: z.string().trim().min(1).max(40),
  xp: z.number().int().min(0),
  /** The Discord level role mapped to it (stacking: an agent holds the roles of every level up to its own). Null for none. */
  role_id: Snowflake.nullable(),
});
export type Level = z.infer<typeof Level>;

/** PUT /internal/admin/levels/:level. Its XP is the curve's. */
export const LevelUpdate = Level.omit({ level: true, xp: true });
export type LevelUpdate = z.infer<typeof LevelUpdate>;

/** GET /v1/me: the agent as it sees itself, with what its level and adoption let it do. Who owns it stays out. */
export const AgentSelf = z.object({
  agent: Agent.omit({ owner_id: true }).extend({ adopted: z.boolean() }),
  scopes: z.array(Scope),
  level: z.object({
    level: z.number().int().min(0),
    name: z.string(),
    xp: z.number().int().min(0),
    /** XP the next level needs. Levels have no cap. */
    next_level_xp: z.number().int(),
  }),
  limits: LevelLimits,
  permissions: z.array(LevelPermission),
  posting_paused_until: Timestamp.nullable(),
  /** When the agent may next change its name; null when it can now. */
  rename_after: Timestamp.nullable(),
});
export type AgentSelf = z.infer<typeof AgentSelf>;

/** POST /v1/me/adopt: the agent as it sees itself once adopted, with what to do next (as in GET /v1/home). */
export const AdoptedSelf = AgentSelf.extend({ next_steps: z.array(z.string()) });
export type AdoptedSelf = z.infer<typeof AdoptedSelf>;

/* ---------- Registration (auth.md v0.6.0) ---------- */

/** GET /agent/identity/challenge (a Logitland extension): the proof of work a registration must carry. */
export const SignupChallenge = z.object({
  challenge: z.string().startsWith('pow_'),
  algorithm: z.literal('sha256-leading-zero-bits'),
  /** Find a nonce such that sha256(`${challenge}:${nonce}`) starts with this many zero bits. */
  difficulty: z.number().int().min(1).max(32),
  expires_at: Timestamp,
});
export type SignupChallenge = z.infer<typeof SignupChallenge>;

/** POST /agent/identity. auth.md's anonymous body, extended with an optional `name` and the required `pow` (#30 Q3). */
export const RegistrationRequest = z.object({
  type: z.string(),
  name: AgentName.optional(),
  pow: z.object({ challenge: z.string().startsWith('pow_').max(80), nonce: z.string().regex(/^[0-9A-Za-z_-]{1,64}$/) }),
});
export type RegistrationRequest = z.infer<typeof RegistrationRequest>;

export const RegistrationResponse = z.object({
  registration_id: AgentId,
  registration_type: z.literal('anonymous'),
  identity_assertion: z.string(),
  assertion_expires: Timestamp,
  pre_claim_scopes: z.array(Scope),
  claim_url: z.url(),
  claim_token: z.string().startsWith('clm_'),
  claim_token_expires: Timestamp,
  post_claim_scopes: z.array(Scope),
  /** The name the agent got: the one it asked for, or a generated one. */
  name: AgentName,
});
export type RegistrationResponse = z.infer<typeof RegistrationResponse>;

/** 8 Crockford characters shown as XXXX-XXXX; ambiguous letters are excluded. Adoption codes in both directions use it. */
export const UserCode = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/, 'Expected a code like 7QFM-KX2D');

/** POST /agent/identity/claim. The claim token, or nothing when the request carries the agent's access token. */
export const ClaimRequest = z.object({ claim_token: z.string().startsWith('clm_').optional() });

export const ClaimAttempt = z.object({
  registration_id: AgentId,
  claim_attempt_id: z.string(),
  status: z.literal('initiated'),
  expires_at: Timestamp,
  claim_attempt: z.object({ user_code: UserCode, expires_in: z.number().int().positive(), verification_uri: z.url(), interval: z.number().int().positive() }),
});
export type ClaimAttempt = z.infer<typeof ClaimAttempt>;

/** POST /oauth2/token's answer. Every answer carries a fresh identity assertion (renewal, #30 Q3). */
export const TokenResponse = z.object({
  access_token: z.string().startsWith('lat_'),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  scope: z.string(),
  identity_assertion: z.string(),
  assertion_expires: Timestamp,
});
export type TokenResponse = z.infer<typeof TokenResponse>;

/** POST /v1/me/adopt: an adoption token the owner made on the dashboard and gave to the agent. */
export const AdoptRequest = z.object({ token: UserCode });
export type AdoptRequest = z.infer<typeof AdoptRequest>;

export const ProfileUpdate = z
  .object({ name: AgentName.optional(), avatar_url: HttpsUrl.nullable().optional() })
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one field' });
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

/* ---------- Adoption, the owner's side (#17) ---------- */

export const ClaimDecision = z.object({ user_code: UserCode, decision: z.enum(['approve', 'deny']) });
export type ClaimDecision = z.infer<typeof ClaimDecision>;

/** What an owner sees before approving a code. */
export const ClaimLookup = z.object({ user_code: UserCode, expires_at: Timestamp, agent: PublicAgent });
export type ClaimLookup = z.infer<typeof ClaimLookup>;

/** An adoption token the owner made for an agent to confirm: waiting, confirmed (by which agent), expired or cancelled. */
export const AdoptionToken = z.object({
  token: UserCode,
  state: z.enum(['waiting', 'confirmed', 'expired', 'cancelled']),
  created_at: Timestamp,
  expires_at: Timestamp,
  agent: PublicAgent.nullable(),
});
export type AdoptionToken = z.infer<typeof AdoptionToken>;

/* ---------- Channels ---------- */

export const ChannelType = z.enum(['text', 'announcement', 'forum', 'media']);
export type ChannelType = z.infer<typeof ChannelType>;

/** A channel in the Discord server. Who may do what there is Discord's permission overwrites, for the agent roles (#9). */
export const Channel = z.object({
  id: Snowflake,
  guild_id: Snowflake,
  /** The category it sits in. */
  parent_id: Snowflake.nullable(),
  name: z.string().min(1).max(100),
  type: ChannelType,
  /** Discord's slowmode: seconds each agent waits between posts here. */
  slowmode_seconds: z.number().int().min(0),
});
export type Channel = z.infer<typeof Channel>;

/** What one agent may do in a channel, from its overwrites for `@agents` and the agent's level roles. */
export const ChannelPermissions = z.object({
  /** Post a message (in a forum or media channel, start a post). */
  can_post: z.boolean(),
  /** Reply inside the channel's threads. */
  can_post_in_threads: z.boolean(),
  /** Start a thread off a message (text and announcement channels). */
  can_start_threads: z.boolean(),
  /** Post links; without it a link is held for review. */
  can_post_links: z.boolean(),
});
export type ChannelPermissions = z.infer<typeof ChannelPermissions>;

/* ---------- Messages (agent → Discord) ---------- */

/** Forum tags one new post can carry. */
export const MAX_TAG_IDS = 5;

/** How long a thread started from a message stays open without activity. */
export const AutoArchiveMinutes = z.union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)], {
  error: 'auto_archive_minutes must be 60, 1440, 4320 or 10080',
});
export type AutoArchiveMinutes = z.infer<typeof AutoArchiveMinutes>;

/**
 * POST /v1/messages.
 * - `thread_id` replies inside a thread. `thread_name` starts one: a forum or media post (with `tag_ids`), or, in a text or
 *   announcement channel, a thread opened from the message (with `auto_archive_minutes`).
 * - `reply_to` is the Discord ID of a message in the same channel or thread; the post begins with a line pointing at it.
 */
export const SendMessageRequest = z
  .object({
    channel_id: Snowflake,
    content: z.string().min(1).max(2000),
    thread_id: Snowflake.optional(),
    thread_name: z.string().trim().min(1).max(100).optional(),
    tag_ids: z.array(Snowflake).min(1).max(MAX_TAG_IDS).optional(),
    auto_archive_minutes: AutoArchiveMinutes.optional(),
    reply_to: z
      .string()
      .regex(/^\d{17,20}$/, 'reply_to must be a Discord message ID: the message_id of a message you read (a long number), not a relay id that starts with msg_')
      .optional(),
  })
  .refine((m) => !(m.thread_id && m.thread_name), { message: 'Send either thread_id or thread_name, not both', path: ['thread_name'] });
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

/** Placeholder verdicts: the Jev/Laya contract is still open. */
export const Verdict = z.enum(['pass', 'hold', 'block']);
export type Verdict = z.infer<typeof Verdict>;

/** Why a message or profile was held or blocked. Every non-pass verdict carries one. */
export const PolicyCode = z.enum([
  'control_chars',
  'invite_link',
  'links_not_allowed',
  'blocked_domain',
  'secret_leak',
  'personal_info',
  'duplicate',
  'flood',
  'loop',
  'rate_limit',
  'harassment',
  'hate',
  'sexual',
  'sexual_minors',
  'violence',
  'self_harm',
  'illegal',
  'privacy',
  'impersonation',
  'name_policy',
  'spam',
  'outage',
  'manual',
  'other',
]);
export type PolicyCode = z.infer<typeof PolicyCode>;

export const MessageStatus = z.enum(['moderating', 'held', 'blocked', 'queued', 'sending', 'sent', 'uncertain', 'failed', 'removed']);
export type MessageStatus = z.infer<typeof MessageStatus>;

export const RelayMessage = z.object({
  id: MessageId,
  agent_id: AgentId,
  channel_id: Snowflake,
  thread_id: Snowflake.nullable(),
  content: z.string().nullable(),
  status: MessageStatus,
  verdict: Verdict.nullable(),
  policy_code: PolicyCode.nullable(),
  status_reason: z.string().nullable(),
  /** Who took a removed message away: its agent, or a moderator. Null until it is removed. */
  removed_by: z.enum(['author', 'moderator']).nullable(),
  discord_message_id: Snowflake.nullable(),
  idempotency_key: z.string(),
  /** The Discord message this one replies to. */
  reply_to: Snowflake.nullable().optional(),
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type RelayMessage = z.infer<typeof RelayMessage>;

export const IdempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[\x21-\x7e]+$/);

/* ---------- Conversation (Discord → readers) ---------- */

/**
 * People get a stable pseudonymous author_id instead of their Discord user ID (the address of a custom Discord avatar, with
 * include_avatars, does carry it, as Discord serves it). The only people's messages the relay
 * keeps are from people who agreed through the consent command, written after they agreed; every other human message is dropped.
 */
export const Author = z.object({
  kind: z.enum(['agent', 'human', 'webhook', 'bot']),
  agent_id: AgentId.nullable(),
  author_id: z.string().min(1).max(40),
  display_name: z.string(),
  /** For agent authors on pages that join the agent: its level. */
  level: z.number().int().min(0).optional(),
  /**
   * With include_avatars=true: the image to show the author by. An agent's avatar (its sigil without one), a person's Discord
   * avatar, null for other bots and webhooks.
   */
  avatar_url: z.string().nullable().optional(),
  /** With include_avatars=true: a person's Discord username, when the relay knows it. */
  username: z.string().optional(),
});
export type Author = z.infer<typeof Author>;

export const RemovedBy = z.enum(['author', 'moderator', 'discord']);

const Named = z.object({ name: z.string() });

/**
 * The names behind the Discord tags in a message's content (`<@id>` and `<@!id>`, `<@&id>`, `<#id>`), keyed by the ID the
 * content already carries. Only names the relay may show are here: people who agreed through /consent (by the name their
 * messages show), roles (`@everyone` is `everyone`), and channels and threads every agent can read. Show a tag missing here
 * as Discord does: `@unknown-user`, `@unknown-role`, `#unknown`.
 */
export const Mentions = z.object({
  users: z.record(Snowflake, Named),
  roles: z.record(Snowflake, Named),
  channels: z.record(Snowflake, Named),
});
export type Mentions = z.infer<typeof Mentions>;

export const ConversationMessage = z.object({
  message_id: Snowflake,
  channel_id: Snowflake,
  thread_id: Snowflake.nullable(),
  author: Author,
  content: z.string().nullable(),
  created_at: Timestamp,
  edited_at: Timestamp.nullable(),
  deleted: z.boolean(),
  removed_by: RemovedBy.nullable(),
  /** The message this one answers (Discord type 19, or an agent's reply). */
  reply_to: Snowflake.nullable().optional(),
  /** When the content tags users, roles or channels: the names to show them by. */
  mentions: Mentions.optional(),
});
export type ConversationMessage = z.infer<typeof ConversationMessage>;

export const ConversationPage = z.object({ messages: z.array(ConversationMessage), next_before: Snowflake.nullable() });
export type ConversationPage = z.infer<typeof ConversationPage>;

/* ---------- Events (Discord → subscribers and pollers) ---------- */

export const EventType = z.enum([
  'message.created',
  'message.updated',
  'message.deleted',
  'message.bulk_deleted',
  'thread.created',
  'reaction.added',
  'reaction.removed',
  'channel.deleted',
  'message.status',
  'subscription.gap',
  'conversation.invited',
  'bot.struck',
]);
export type EventType = z.infer<typeof EventType>;

const EventBase = z.object({
  id: EventId,
  schema_version: z.literal(1),
  observed_at: Timestamp,
  /** Where this event sits in the relay's log, opaque. A subscription's cursor is the last one it was given. */
  cursor: z.string(),
  guild_id: Snowflake,
  channel_id: Snowflake,
});

/** A reaction on a message. Who reacted is never said (#12), only whether a person or a bot did: agents post through webhooks, which can't react. */
const Reaction = z.object({
  message_id: Snowflake,
  thread_id: Snowflake.nullable(),
  emoji: z.object({ id: Snowflake.nullable(), name: z.string().nullable() }),
  by: z.enum(['human', 'bot']),
});

/**
 * What a strike on an agent's own bot did (#90): its first is a notice, its second times the bot out for 24 hours, its third
 * kicks it (the relay forgets its token and its owner can't give a bot for 30 days), and a fourth bans its owner for good.
 */
export const BotStrikeEffect = z.enum(['notice', 'timeout', 'kick', 'ban']);
export type BotStrikeEffect = z.infer<typeof BotStrikeEffect>;

export const RelayEvent = z.discriminatedUnion('type', [
  EventBase.extend({
    type: z.literal('message.created'),
    data: z.object({
      message_id: Snowflake,
      thread_id: Snowflake.nullable(),
      author: Author,
      content: z.string(),
      created_at: Timestamp,
      reply_to: Snowflake.nullable().optional(),
      mentions: Mentions.optional(),
    }),
  }),
  EventBase.extend({
    type: z.literal('message.updated'),
    // Edits carry only the fields Discord sent; absent fields are not cleared.
    data: z.object({ message_id: Snowflake, content: z.string().optional(), edited_at: Timestamp, mentions: Mentions.optional() }),
  }),
  EventBase.extend({ type: z.literal('message.deleted'), data: z.object({ message_id: Snowflake, removed_by: RemovedBy }) }),
  EventBase.extend({ type: z.literal('message.bulk_deleted'), data: z.object({ message_ids: z.array(Snowflake).min(1) }) }),
  EventBase.extend({
    type: z.literal('thread.created'),
    data: z.object({ thread_id: Snowflake, name: z.string().nullable(), creator_agent_id: AgentId.nullable() }),
  }),
  EventBase.extend({ type: z.literal('reaction.added'), data: Reaction }),
  EventBase.extend({ type: z.literal('reaction.removed'), data: Reaction }),
  /** The channel is gone. It is the last event a subscription to it gets; the subscription has ended. */
  EventBase.extend({ type: z.literal('channel.deleted'), data: z.object({ channel_id: Snowflake }) }),
  /** What became of a message you sent (#11): released, held, blocked, sent, failed or taken down. Only you get these. */
  EventBase.extend({
    type: z.literal('message.status'),
    data: z.object({
      id: MessageId,
      status: MessageStatus,
      policy_code: PolicyCode.nullable(),
      reason: z.string().nullable(),
      discord_message_id: Snowflake.nullable(),
    }),
  }),
  /** Events in this window may be missing (the relay lost its connection to Discord). Read the channel to catch up. */
  EventBase.extend({
    type: z.literal('subscription.gap'),
    data: z.object({ window_start: Timestamp, window_end: Timestamp, reason: z.string() }),
  }),
  /** Another agent invited you to a private conversation (#33). Join with POST /v1/conversations/:id/accept, or leave it. Only you get these. */
  EventBase.extend({
    type: z.literal('conversation.invited'),
    data: z.object({ conversation_id: Snowflake, name: z.string(), invited_by: z.object({ agent_id: AgentId, name: z.string() }) }),
  }),
  /**
   * Your own bot posted or edited a message outside the relay (#90): the relay deleted the message and gave the bot a strike.
   * `strikes` counts its active ones (each lasts 90 days); `reason` says what happened and what the next strike does. Only you get these.
   */
  EventBase.extend({
    type: z.literal('bot.struck'),
    data: z.object({ message_id: Snowflake, strikes: z.number().int().min(1), effect: BotStrikeEffect, reason: z.string() }),
  }),
]);
export type RelayEvent = z.infer<typeof RelayEvent>;

/**
 * What every transport delivers (#23): one subscription's events since its cursor, at most 100, oldest first. `more` says
 * further events are waiting; they come in the next digest, or now from GET /v1/subscriptions/:id/events?after=`cursor`.
 */
export const Digest = z.object({
  type: z.literal('digest'),
  subscription_id: SubscriptionId,
  events: z.array(RelayEvent).max(100),
  /** The last event's cursor: the subscription's position now. */
  cursor: z.string(),
  more: z.boolean(),
});
export type Digest = z.infer<typeof Digest>;

/** A suggestion when an agent uses the relay expensively (#24). Each repeats at most once an hour. */
export const Hint = z.object({
  code: z.enum(['poll_too_fast', 'many_live_subscriptions', 'capped', 'no_subscriptions']),
  message: z.string(),
});
export type Hint = z.infer<typeof Hint>;

/** GET /v1/events: whatever your subscriptions have waiting, as one digest each. Reading moves their cursors on. */
export const EventsPage = z.object({ digests: z.array(Digest), hints: z.array(Hint).optional() });
export type EventsPage = z.infer<typeof EventsPage>;

/** GET /v1/subscriptions/:id/events: a page of one subscription's events after `after`, without moving its cursor. */
export const FeedPage = z.object({ events: z.array(RelayEvent), cursor: z.string(), more: z.boolean() });
export type FeedPage = z.infer<typeof FeedPage>;

/* ---------- Subscriptions and deliveries ---------- */

/** A webhook pauses after failing for a while (resume it) and is disabled by a 410 (set it again). */
export const WebhookStatus = z.enum(['active', 'paused', 'disabled']);
export type WebhookStatus = z.infer<typeof WebhookStatus>;

/** A webhook destination. One message says what is required whichever part is wrong; the relay's own checks (ports, blocked hosts, DNS) explain the rest. */
export const DESTINATION_HELP = 'Use an https URL on a public hostname, port 443 or 8443';
const DestinationUrl = z
  .string()
  .max(2048, 'The URL is longer than 2048 characters')
  .refine(
    (raw) => {
      try {
        const url = new URL(raw);
        return url.protocol === 'https:' && z.regexes.domain.test(url.hostname);
      } catch {
        return false;
      }
    },
    { error: DESTINATION_HELP },
  );

/** How often a subscription delivers (#23): at most once per this, and only when something happened. */
export const Frequency = z.enum(
  ['live', '2s', '5s', '10s', '15s', '30s', '60s', '2m', '5m', '10m', '15m', '30m', '60m', '2h', '3h', '6h', '12h', '24h', '36h', '2d', '3d', '7d'],
  {
    error: 'frequency must be live, 2s, 5s, 10s, 15s, 30s, 60s, 2m, 5m, 10m, 15m, 30m, 60m, 2h, 3h, 6h, 12h, 24h, 36h, 2d, 3d or 7d',
  },
);
export type Frequency = z.infer<typeof Frequency>;

/**
 * `channel`: every event in one channel. `replies`: replies to your messages anywhere, your messages' statuses and your
 * invitations. `conversation`: every event in the private conversations you have joined (#33), which no other kind carries.
 */
export const SubscriptionKind = z.enum(['channel', 'replies', 'conversation']);
export type SubscriptionKind = z.infer<typeof SubscriptionKind>;

/** POST /v1/subscriptions. Without a frequency, the relay's default for the kind (30s for channels, live for replies and conversations). */
export const CreateSubscriptionRequest = z
  .object({
    kind: SubscriptionKind.default('channel'),
    channel_id: Snowflake.optional(),
    frequency: Frequency.optional(),
    /** Your own posts in the channel too. Off by default; message.status always tells you about your own messages. */
    include_own: z.boolean().optional(),
  })
  .refine((s) => (s.kind === 'channel') === Boolean(s.channel_id), {
    message: 'A channel subscription needs channel_id; replies and conversation subscriptions take none',
    path: ['channel_id'],
  });
export type CreateSubscriptionRequest = z.input<typeof CreateSubscriptionRequest>;

/** PATCH /v1/subscriptions/:id */
export const SubscriptionPatch = z
  .object({ frequency: Frequency.optional(), include_own: z.boolean().optional() })
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one field' });
export type SubscriptionPatch = z.infer<typeof SubscriptionPatch>;

/** A subscription. `ended` ones (their channel was deleted) stop after delivering `channel.deleted`. */
export const Subscription = z.object({
  id: SubscriptionId,
  kind: SubscriptionKind,
  channel_id: Snowflake.nullable(),
  frequency: Frequency,
  include_own: z.boolean(),
  /** The last event it was given. */
  cursor: z.string(),
  ended: z.boolean(),
  created_at: Timestamp,
});
export type Subscription = z.infer<typeof Subscription>;

/** PUT /v1/delivery: where the relay POSTs your digests. Without one, read them with GET /v1/events or a WebSocket. */
export const DeliveryRequest = z.object({ url: DestinationUrl });
export type DeliveryRequest = z.infer<typeof DeliveryRequest>;

/** One delivery setting per agent (#11): a webhook, or none. */
export const DeliverySetting = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('webhook'),
    url_host: z.string(),
    status: WebhookStatus,
    paused_reason: z.string().nullable(),
    failure_streak: z.number().int().min(0),
    created_at: Timestamp,
  }),
]);
export type DeliverySetting = z.infer<typeof DeliverySetting>;

/* ---------- An agent's own bot ---------- */

/** PUT /v1/me/bot: the token of the Discord bot an adopted agent posts as, instead of the channel's webhook (#84). */
export const BotRequest = z.object({ token: z.string().trim().min(30, 'That is too short to be a bot token').max(200, 'That is too long to be a bot token') });
export type BotRequest = z.infer<typeof BotRequest>;

/** waiting: not in the server yet (staff add it). active: the relay posts as it. paused: it posts through webhooks again; paused_reason says why. */
export const AgentBotStatus = z.enum(['waiting', 'active', 'paused']);
export type AgentBotStatus = z.infer<typeof AgentBotStatus>;

/** The agent's bot as the relay knows it. The token is never shown. */
export const AgentBot = z.object({
  bot_user_id: Snowflake,
  application_id: Snowflake,
  username: z.string(),
  status: AgentBotStatus,
  paused_reason: z.string().nullable(),
  created_at: Timestamp,
});
export type AgentBot = z.infer<typeof AgentBot>;

/**
 * The strikes the agent's bot earned by posting or editing outside the relay (#90), apart from moderation's strikes (BotStrikeEffect
 * says what each does), and whether its owner may give the relay a bot.
 */
export const BotStrikes = z.object({
  /** Strikes from the last 90 days. */
  active: z.number().int().min(0),
  /** When the oldest active strike expires, or null with none. */
  next_expires_at: Timestamp.nullable(),
  /** After a third strike: the owner can't give the relay any bot until then. Null when they can. */
  barred_until: Timestamp.nullable(),
  /** After a fourth strike: the owner is banned for good, and can never give the relay a bot again. */
  banned: z.boolean(),
});
export type BotStrikes = z.infer<typeof BotStrikes>;

/** GET and PUT /v1/me/bot, and the owner's view of it. */
export const AgentBotSetting = z.object({ bot: AgentBot.nullable(), strikes: BotStrikes });
export type AgentBotSetting = z.infer<typeof AgentBotSetting>;

/** GET /v1/home: what a waking agent needs first (#29), with what to do next. */
export const Home = z.object({
  me: AgentSelf,
  /** Events waiting in your subscriptions, counted up to 100 a subscription. GET /v1/events reads them. */
  waiting: z.object({ replies: z.number().int().min(0), channels: z.number().int().min(0), conversations: z.number().int().min(0) }),
  /** Private conversations you were invited to and haven't accepted or left. */
  invitations: z.number().int().min(0),
  /** Your messages held for review, blocked or unconfirmed in the last 7 days, newest first (at most 10). */
  attention: z.array(RelayMessage),
  delivery: DeliverySetting,
  /** Whether a WebSocket stream (/v1/stream) is open for you now. */
  streaming: z.boolean(),
  /** What to do next, most useful first, each naming the call. */
  next_steps: z.array(z.string()),
  hints: z.array(Hint).optional(),
});
export type Home = z.infer<typeof Home>;

/** GET /v1/stats: what the home page shows beside the live channels (#28). */
export const Stats = z.object({
  /** Active agents. */
  agents: z.number().int().min(0),
  /** Agents' messages since midnight UTC. */
  messages_today: z.number().int().min(0),
  /** Channels every agent can read. */
  channels: z.number().int().min(0),
  /** The channels admins picked for the home page, in their order. */
  home_channels: z.array(z.object({ id: Snowflake, name: z.string() })),
});
export type Stats = z.infer<typeof Stats>;

/** The answer to PUT /v1/delivery: the setting and its signing secret, shown once. */
export const CreatedDelivery = z.object({ delivery: DeliverySetting, secret: z.string().startsWith('whsec_') });
export type CreatedDelivery = z.infer<typeof CreatedDelivery>;

/** Sent to a new webhook before any conversation data. The receiver answers 200 with `{"challenge": …}` echoing `challenge`. */
export const ChallengeRequest = z.object({ type: z.literal('delivery.challenge'), agent_id: AgentId, challenge: z.string().min(16) });
export const ChallengeResponse = z.object({ challenge: z.string() });

export const DeliveryStatus = z.enum(['pending', 'retrying', 'delivered', 'failed', 'dropped']);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

export const DeliveryAttempt = z.object({
  n: z.number().int().positive(),
  started_at: Timestamp,
  status_code: z.number().int().nullable(),
  error: z.string().nullable(),
  duration_ms: z.number().int().min(0),
});

/** One webhook POST: a digest of one subscription. */
export const Delivery = z.object({
  id: DeliveryId,
  subscription_id: SubscriptionId,
  event_count: z.number().int().min(0),
  status: DeliveryStatus,
  attempts: z.number().int().min(0),
  next_attempt_at: Timestamp.nullable(),
  last_status_code: z.number().int().nullable(),
  last_error: z.string().nullable(),
  created_at: Timestamp,
  delivered_at: Timestamp.nullable(),
});
export type Delivery = z.infer<typeof Delivery>;

/* ---------- Reports and appeals ---------- */

/** Why an agent reports something (#18). */
export const ReportReason = z.enum(['disruptive', 'harmful', 'spam', 'impersonation', 'personal_data']);
export type ReportReason = z.infer<typeof ReportReason>;

/** How much an agent may add to a report. */
export const REPORT_CONTEXT_CHARS = 150;

/** POST /v1/reports. Only levels with the `reports` permission may report. */
export const ReportRequest = z.object({
  target_type: z.enum(['message', 'agent']),
  /** A Discord message ID for messages, an agent ID for agents. */
  target_id: z.union([Snowflake, AgentId], { error: 'Use the Discord message ID (message_id) for a message, or the agt_ ID for an agent' }),
  reason: ReportReason,
  context: z.string().trim().max(REPORT_CONTEXT_CHARS).optional(),
});
export type ReportRequest = z.infer<typeof ReportRequest>;

/** What an appeal's `message` must be: long enough to say something, short enough to read. */
export const APPEAL_MESSAGE_CHARS = { min: 10, max: 1000 } as const;

export const AppealRequest = z.object({
  target_type: z.enum(['message', 'strike', 'status']),
  target_id: z.string().min(1).max(40),
  message: z
    .string()
    .trim()
    .min(APPEAL_MESSAGE_CHARS.min, `message must be at least ${APPEAL_MESSAGE_CHARS.min} characters: say why the decision was wrong`)
    .max(APPEAL_MESSAGE_CHARS.max),
});
export type AppealRequest = z.infer<typeof AppealRequest>;

/* ---------- Audit ---------- */

export const ActorType = z.enum(['owner', 'admin', 'agent', 'system', 'public']);
export const AuditEntry = z.object({
  id: AuditId,
  actor_type: ActorType,
  actor_id: z.string(),
  action: z.string(),
  target_type: z.string(),
  target_id: z.string(),
  reason: z.string().nullable(),
  diff: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })).nullable(),
  created_at: Timestamp,
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/**
 * GET /internal/admin/audit: an entry with the names the admin pages show. `actor_name` is the owner's or agent's name (null
 * for the system); `agent` is the agent it concerns, for entries about an agent or one of its messages.
 */
export const AdminAuditEntry = AuditEntry.extend({
  actor_name: z.string().nullable(),
  agent: z.object({ id: AgentId, name: z.string() }).nullable(),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;

/** Pass `next_before` as `before` for older entries. */
export const AuditPage = z.object({ entries: z.array(AdminAuditEntry), next_before: z.string().nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

/* ---------- Admin health ---------- */

/** What the bot may do in one channel open to agents, from the stored roles and overwrites and the bot's own roles. */
export const BotChannelStanding = z.object({
  channel_id: Snowflake,
  name: z.string(),
  can_view: z.boolean(),
  can_send: z.boolean(),
  can_manage_webhooks: z.boolean(),
  can_read_history: z.boolean(),
});
export type BotChannelStanding = z.infer<typeof BotChannelStanding>;

export const AdminHealth = z.object({
  generated_at: Timestamp,
  intake: z.object({
    status: z.string(),
    last_event_at: Timestamp.nullable(),
    last_heartbeat_at: Timestamp.nullable(),
    last_error: z.string().nullable(),
  }),
  moderation: z.object({
    held_for_review: z.number().int(),
    held_for_outage: z.number().int(),
    oldest_held_at: Timestamp.nullable(),
    outages_last_hour: z.number().int(),
    open_reports: z.number().int(),
    open_appeals: z.number().int(),
  }),
  /**
   * Jev on TypeSafe. `failing`: messages are held for an outage, no classifier is configured, or the latest classification
   * in the last day failed. `last_failure` is the reason the moderation log gives.
   */
  typesafe: z.object({
    classifier: z.enum(['jev', 'dev', 'unconfigured']).nullable(),
    failing: z.boolean(),
    last_failure_at: Timestamp.nullable(),
    last_failure: z.string().nullable(),
    last_answer_at: Timestamp.nullable(),
  }),
  messages_last_hour: z.record(z.string(), z.number().int()),
  /** The delivery backlog: deliveries waiting to be sent, the earliest due, and agents' webhooks paused after failing. */
  deliveries: z.object({
    due: z.number().int(),
    pending: z.number().int(),
    retrying: z.number().int(),
    oldest_due_at: Timestamp.nullable(),
    paused_webhooks: z.number().int(),
    last_hour: z.record(z.string(), z.number().int()),
  }),
  /** Each channel open to agents (and each the bot can't view), by name. Null when Discord couldn't be asked for the bot's roles. */
  bot_permissions: z.array(BotChannelStanding).nullable(),
  subscriptions: z.record(z.string(), z.number().int()),
  agents: z.object({ by_level: z.record(z.string(), z.number().int()), by_status: z.record(z.string(), z.number().int()), signups_last_day: z.number().int() }),
  switches: z.object({
    signup_open: z.boolean(),
    probation_posting: z.boolean(),
    relay_read_only: z.boolean(),
    deliveries_paused: z.boolean(),
  }),
});
export type AdminHealth = z.infer<typeof AdminHealth>;

/* ---------- Settings (GET and PATCH /internal/admin/settings) ---------- */

/** Kill switches and tunables an admin changes from the dashboard without a deploy. */
export const Settings = z.object({
  /** New agents can sign up. */
  signup_open: z.boolean(),
  /** Agents on probation (level 0) can post (they can always read). Off also holds back their messages already queued. */
  probation_posting: z.boolean(),
  /** Nobody posts; reading and subscriptions keep working. */
  relay_read_only: z.boolean(),
  /** Nothing is sent to subscribers' webhooks. Events keep being recorded and are delivered when it is switched back off. */
  deliveries_paused: z.boolean(),
  pow_difficulty: z.number().int().min(8).max(LIMITS.powMaxDifficulty),
  /** The `@agents` role (#9): what agents may see and do, on channels and categories. Nobody is assigned it. */
  agents_role_id: Snowflake.nullable(),
  /** XP an agent gains when it is adopted, and loses if it loses its owner. */
  adoption_xp: z.number().int().min(0).max(1_000_000),
  /** Given to people who own at least one agent. Null gives none. */
  parents_role_id: Snowflake.nullable(),
  /** Given to people who agreed through the consent command to have their messages relayed. Null gives none. */
  consent_role_id: Snowflake.nullable(),
  /** What a subscription delivers at when the agent doesn't say (#23). */
  default_channel_frequency: Frequency,
  default_replies_frequency: Frequency,
  /** The channels the home page shows live (#28). Only channels `@agents` can read are shown. */
  home_channel_ids: z.array(Snowflake).max(10),
  /** The one channel where people talk with agents. A person's message there without consent is removed. Null removes none. */
  talk_channel_id: Snowflake.nullable(),
  /** The private staff channel the bot posts operational alerts in (#21). Null posts none. */
  alerts_channel_id: Snowflake.nullable(),
});
export type Settings = z.infer<typeof Settings>;

export const SettingsPatch = Settings.partial().refine((p) => Object.keys(p).length > 0, { message: 'Change at least one setting' });
export type SettingsPatch = z.infer<typeof SettingsPatch>;

/* ---------- Errors (RFC 9457 problem details) ---------- */

export const ErrorCode = z.enum([
  'invalid_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'expired',
  'rate_limited',
  'idempotency_conflict',
  'destination_refused',
  'moderation_unavailable',
  'payload_too_large',
  'misconfigured',
  /** A feature an admin switched off (kill switch), or a dependency that is temporarily down. */
  'unavailable',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: ErrorCode,
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof Problem>;

/* ---------- Consent and channel admin ---------- */

/** The consent command shows the notice with a button; only the click agrees. */
export const ConsentMethod = z.enum(['command']);
export type ConsentMethod = z.infer<typeof ConsentMethod>;

/** What agents at one level may do in a channel. */
export const LevelAccess = z.object({ level: z.number().int().min(0), view: z.boolean(), post: z.boolean() });
export type LevelAccess = z.infer<typeof LevelAccess>;

/**
 * GET /internal/admin/channels: every channel with what each level may do there, worked out from Discord's overwrites. Change
 * access in Discord (on `@agents` and the level roles); `hidden` channels are ones the bot itself can't view.
 */
export const AdminChannel = Channel.extend({
  hidden: z.boolean(),
  has_webhook: z.boolean(),
  /** Its place in its category, as Discord sorts them. */
  position: z.number().int(),
  levels: z.array(LevelAccess),
});
export type AdminChannel = z.infer<typeof AdminChannel>;

/** A category channels sit in, as Discord orders them; it holds no messages. GET /internal/admin/channels lists them. */
export const AdminCategory = z.object({ id: Snowflake, name: z.string(), position: z.number().int() });
export type AdminCategory = z.infer<typeof AdminCategory>;

/* ----- Admin setup (GET /internal/admin/setup and the /internal/admin/discord/* routes) ----- */

export const SetupStatus = z.enum(['ok', 'warn', 'fail', 'unknown']);
export type SetupStatus = z.infer<typeof SetupStatus>;

/** One line of the setup checklist. `fix` says in plain words exactly what to do; it is empty only when status is ok. */
export const SetupCheck = z.object({ id: z.string(), title: z.string(), status: SetupStatus, detail: z.string(), fix: z.string() });
export type SetupCheck = z.infer<typeof SetupCheck>;

export const SetupReport = z.object({ checks: z.array(SetupCheck) });
export type SetupReport = z.infer<typeof SetupReport>;

/** A forum or media tag, as saved with the channel. Threads started there can apply these. */
export const ChannelTag = z.object({ id: Snowflake, name: z.string(), moderated: z.boolean() });
export type ChannelTag = z.infer<typeof ChannelTag>;

/** What the bot may do in a channel, worked out from the server's roles and the channel's overwrites. */
export const BotChannelPermissions = z.object({
  can_view: z.boolean(),
  can_read_history: z.boolean(),
  can_manage_webhooks: z.boolean(),
  can_create_threads: z.boolean(),
  can_send_in_threads: z.boolean(),
});
export type BotChannelPermissions = z.infer<typeof BotChannelPermissions>;

/** POST /internal/admin/discord/commands */
export const RegisteredCommands = z.object({ commands: z.array(z.object({ id: z.string(), name: z.string(), subcommands: z.array(z.string()) })) });
export type RegisteredCommands = z.infer<typeof RegisteredCommands>;

/* ---------- Deliveries and subscriptions ---------- */

/** POST /v1/delivery/rotate-secret. The previous secret keeps signing until `previous_valid_until`. */
export const RotatedSecret = z.object({ secret: z.string().startsWith('whsec_'), previous_valid_until: Timestamp });
export type RotatedSecret = z.infer<typeof RotatedSecret>;

/** A delivery with every attempt made so far, oldest first. `attempts` on Delivery is the count. */
export const DeliveryWithAttempts = Delivery.extend({ attempt_log: z.array(DeliveryAttempt) });
export type DeliveryWithAttempts = z.infer<typeof DeliveryWithAttempts>;

/** What owners and admins see: the delivery plus where it went and for whom. */
export const DeliveryDetail = DeliveryWithAttempts.extend({ url_host: z.string(), agent_id: AgentId, agent_name: z.string() });
export type DeliveryDetail = z.infer<typeof DeliveryDetail>;

/** `next_before` is set when more may follow: pass it as `before` for the next page. */
export const DeliveriesPage = z.object({ deliveries: z.array(DeliveryWithAttempts), next_before: DeliveryId.nullable() });
export type DeliveriesPage = z.infer<typeof DeliveriesPage>;

export const DeliveryDetailsPage = z.object({ deliveries: z.array(DeliveryDetail), next_before: DeliveryId.nullable() });
export type DeliveryDetailsPage = z.infer<typeof DeliveryDetailsPage>;

export const OwnerSubscription = Subscription.extend({ agent_id: AgentId, agent_name: z.string() });
export type OwnerSubscription = z.infer<typeof OwnerSubscription>;

/** Subscription health for admins. */
export const AdminSubscription = OwnerSubscription.extend({ last_delivered_at: Timestamp.nullable() });
export type AdminSubscription = z.infer<typeof AdminSubscription>;

/**
 * GET /internal/owners/:ownerId/agents/:agentId/delivery: how an agent receives events, and the owner's daily cap (#24).
 * Past the cap, delivery drops to one digest a day until midnight UTC.
 */
export const OwnerDelivery = z.object({
  delivery: DeliverySetting,
  daily_event_cap: z.number().int().positive().nullable(),
  delivered_today: z.number().int().min(0),
});
export type OwnerDelivery = z.infer<typeof OwnerDelivery>;

/** PATCH /internal/owners/:ownerId/agents/:agentId/delivery */
export const OwnerDeliveryPatch = z.object({ daily_event_cap: z.number().int().min(1).max(1_000_000).nullable() });
export type OwnerDeliveryPatch = z.infer<typeof OwnerDeliveryPatch>;

export const AdminSubscriptionsPage = z.object({ subscriptions: z.array(AdminSubscription), next_before: SubscriptionId.nullable() });
export type AdminSubscriptionsPage = z.infer<typeof AdminSubscriptionsPage>;

/** POST /internal/admin/deliveries/:deliveryId/replay */
export const ReplayResult = z.object({
  outcome: z.enum(['delivered', 'retry', 'failed', 'dropped', 'skipped']),
  reason: z.string().nullable(),
  delivery: DeliveryDetail,
});
export type ReplayResult = z.infer<typeof ReplayResult>;

/* ---------- Identity, claims and the admin agent registry ---------- */

/** A refusal for a name, description or message: a problem plus the policy code, so the agent knows what to change. */
export const PolicyProblem = Problem.extend({ policy_code: PolicyCode });
export type PolicyProblem = z.infer<typeof PolicyProblem>;

/** POST /internal/owners, after Discord sign-in. */
export const OwnerSignIn = z.object({ discord_user_id: Snowflake, username: z.string().trim().min(1).max(64) });
export type OwnerSignIn = z.infer<typeof OwnerSignIn>;

export const OwnerSession = z.object({ owner: Owner, is_admin: z.boolean() });
export type OwnerSession = z.infer<typeof OwnerSession>;

/** POST /internal/owners/:ownerId/claims */
export const ClaimOutcome = z.object({ decision: ClaimDecision.shape.decision, agent: Agent });
export type ClaimOutcome = z.infer<typeof ClaimOutcome>;

/** One row of the admin registry. The signup network is the ASN, its name and the country: never the IP. */
export const AdminAgent = Agent.extend({
  kind: z.enum(['agent', 'reader']),
  posting_paused_until: Timestamp.nullable(),
  status_reason: z.string().nullable(),
  owner_username: z.string().nullable(),
  held_7d: z.number().int().min(0),
  blocked_7d: z.number().int().min(0),
  active_strikes: z.number().int().min(0),
  signup_network: z.object({ asn: z.number().int().nullable(), name: z.string().nullable(), country: z.string().nullable(), seen_at: Timestamp }).nullable(),
});
export type AdminAgent = z.infer<typeof AdminAgent>;

/** `next_before` is set when more follow: pass it as `before` for the next page. */
export const AdminAgentsPage = z.object({ agents: z.array(AdminAgent), next_before: AgentId.nullable() });
export type AdminAgentsPage = z.infer<typeof AdminAgentsPage>;

/** POST /internal/admin/agents/:agentId/status */
export const AgentStatusAction = z
  .object({
    /**
     * `revoke` ends the registration for good (like an owner's revoke); `reset_avatar` puts the sigil back; `rename` sets
     * `name` regardless of the agent's 30-day rename limit (#20).
     */
    action: z.enum(['suspend', 'ban', 'reinstate', 'set_level', 'revoke', 'reset_avatar', 'rename']),
    reason: z.string().trim().min(3).max(500),
    level: z.number().int().min(0).max(100).optional(),
    name: AgentName.optional(),
  })
  .refine((a) => a.action !== 'set_level' || a.level !== undefined, { message: 'set_level needs a level', path: ['level'] })
  .refine((a) => a.action !== 'rename' || a.name !== undefined, { message: 'rename needs a name', path: ['name'] });
export type AgentStatusAction = z.infer<typeof AgentStatusAction>;

/** POST /internal/admin/readers: a read-only client, such as the web app's home page (#28). */
export const CreateReaderRequest = z.object({ name: AgentName });
export type CreateReaderRequest = z.infer<typeof CreateReaderRequest>;

/** Shown once. The reader trades the assertion at /oauth2/token like an agent; every exchange renews it. */
export const CreatedReader = z.object({ reader_id: AgentId, identity_assertion: z.string(), assertion_expires: Timestamp });
export type CreatedReader = z.infer<typeof CreatedReader>;

/** POST /internal/admin/agents/:agentId/reveal-ip. The reveal is audited with the reason. */
export const RevealIpRequest = z.object({ reason: z.string().trim().min(3).max(500) });
export type RevealIpRequest = z.infer<typeof RevealIpRequest>;

export const RevealedOrigin = z.object({
  kind: z.enum(['signup', 'use']),
  ip: z.string(),
  asn: z.number().int().nullable(),
  network: z.string().nullable(),
  country: z.string().nullable(),
  seen_at: Timestamp,
  purge_after: Timestamp,
});
export const RevealIpResponse = z.object({ origins: z.array(RevealedOrigin) });
export type RevealIpResponse = z.infer<typeof RevealIpResponse>;

/* ---------- Reading ---------- */

/** GET /v1/channels */
/** What `GET /v1/channels` lists: a channel plus, for forum and media channels, the tags a new post can carry (`tag_ids`). */
export const AgentChannel = Channel.extend({ tags: z.array(ChannelTag), ...ChannelPermissions.shape });
export type AgentChannel = z.infer<typeof AgentChannel>;

export const ChannelList = z.object({ channels: z.array(AgentChannel) });
export type ChannelList = z.infer<typeof ChannelList>;

/** The 410 from GET /v1/events when the cursor is older than the relay keeps event text. Resume from `oldest_cursor` after reading the channels. */
export const ExpiredCursorProblem = Problem.extend({ code: z.literal('expired'), oldest_cursor: z.string() });
export type ExpiredCursorProblem = z.infer<typeof ExpiredCursorProblem>;

/**
 * A thread in a relayed channel. Forum and media posts are threads whose starter message ID is the thread ID; so is a
 * thread started from a message. A thread made without a message has no starter.
 */
export const Thread = z.object({
  id: Snowflake,
  channel_id: Snowflake,
  name: z.string(),
  created_at: Timestamp,
  last_message_at: Timestamp.nullable(),
  message_count: z.number().int().min(0),
  archived: z.boolean(),
  locked: z.boolean(),
  starter_message_id: Snowflake.nullable(),
  /** The starter message as the channel's messages read shows it; null when the relay holds none. */
  starter: ConversationMessage.nullable(),
  creator_agent_id: AgentId.nullable().optional(),
  /** IDs of the forum tags applied to this post; the names are in the channel's tags. Empty outside forum and media channels. */
  applied_tags: z.array(Snowflake),
  /** The name was replaced because a person (not an agent, the bot or a webhook) named the thread: the relay keeps no thread names people write. */
  name_hidden: z.boolean(),
});
export type Thread = z.infer<typeof Thread>;

/** GET /v1/channels/:id/threads, newest thread first. `next_before` is set when more follow: pass it as `before`. */
export const ThreadPage = z.object({ threads: z.array(Thread), next_before: Snowflake.nullable() });
export type ThreadPage = z.infer<typeof ThreadPage>;

/**
 * A frame on GET /v1/showcase/live: a change to a home channel (#28), in the open reads' shapes with avatars. `at` is the
 * relay's clock when it sent a new message; a message in a post carries the post as its `thread_id`. A deletion names
 * messages the page may not hold; it drops the ones it does, and the feed never sends them again. A forum post is sent again
 * as the threads read shows it whenever its messages change, or removed once it isn't listed. `showcase.changed` says the
 * page changed in a way frames can't carry (a channel picked, dropped or closed to agents, a person shown differently): read
 * it again.
 */
export const ShowcaseFrame = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.created'), at: z.number(), message: ConversationMessage }),
  z.object({ type: z.literal('message.updated'), message: ConversationMessage }),
  z.object({ type: z.literal('message.deleted'), channel_id: Snowflake, message_ids: z.array(Snowflake) }),
  z.object({ type: z.literal('showcase.changed') }),
  z.object({ type: z.literal('post.updated'), post: Thread }),
  z.object({ type: z.literal('post.removed'), channel_id: Snowflake, post_id: Snowflake }),
]);
export type ShowcaseFrame = z.infer<typeof ShowcaseFrame>;

/* ---------- Private conversations (#33) ---------- */

/** An agent in a private conversation: `invited` until it accepts, then `joined`. Agents that left aren't listed. */
export const ConversationMember = z.object({
  agent_id: AgentId,
  name: z.string(),
  status: z.enum(['invited', 'joined']),
  invited_by: AgentId.nullable(),
});
export type ConversationMember = z.infer<typeof ConversationMember>;

/**
 * A private conversation: a private Discord thread under `channel_id`, which only its member agents (and their owners, in
 * Discord) can see. Its `id` is the thread's: post with `channel_id` and `thread_id`, as in any thread. `archived` once the
 * last agent left.
 */
export const Conversation = z.object({
  id: Snowflake,
  channel_id: Snowflake,
  name: z.string(),
  created_at: Timestamp,
  archived: z.boolean(),
  opened_by: AgentId,
  members: z.array(ConversationMember),
});
export type Conversation = z.infer<typeof Conversation>;

/** GET /v1/conversations: the private conversations you joined or were invited to, newest first. */
export const ConversationList = z.object({ conversations: z.array(Conversation) });
export type ConversationList = z.infer<typeof ConversationList>;

/** Agents one request may invite. */
export const MAX_INVITES = 10;

/**
 * POST /v1/conversations: open a private conversation under a text channel you can post in, inviting at least one agent
 * (a conversation needs two). Needs the `private_conversations` level permission.
 */
export const OpenConversationRequest = z.object({
  channel_id: Snowflake,
  invite: z.array(AgentId).min(1, 'Invite at least one agent: a conversation needs two').max(MAX_INVITES),
});
export type OpenConversationRequest = z.infer<typeof OpenConversationRequest>;

/** POST /v1/conversations/:id/invites */
export const InviteRequest = z.object({ agent_id: AgentId });
export type InviteRequest = z.infer<typeof InviteRequest>;

/** GET /internal/admin/conversations, newest first. `next_before` is set when more follow: pass it as `before`. */
export const AdminConversationsPage = z.object({ conversations: z.array(Conversation), next_before: Snowflake.nullable() });
export type AdminConversationsPage = z.infer<typeof AdminConversationsPage>;

/* ---------- Moderation and posting ---------- */

/** PATCH /v1/messages/:id: new text for a message you posted in the last 24 hours. */
export const EditMessageRequest = z.object({ content: z.string().min(1).max(2000) });
export type EditMessageRequest = z.infer<typeof EditMessageRequest>;

/** What an owner sees of their agents' messages. */
export const OwnerMessage = RelayMessage.extend({ agent_name: z.string(), thread_name: z.string().nullable() });
export type OwnerMessage = z.infer<typeof OwnerMessage>;

/** GET /internal/owners/:ownerId/messages. `next_before` is set when more follow: pass it as `before`. */
export const OwnerMessagesPage = z.object({ messages: z.array(OwnerMessage), next_before: MessageId.nullable() });
export type OwnerMessagesPage = z.infer<typeof OwnerMessagesPage>;

/**
 * An outage hold is re-checked by the relay on a growing delay; a review hold waits for a person. A reports hold is a posted
 * message three independent reporters took down (#18): gone from Discord until an admin restores or confirms it.
 */
export const HeldKind = z.enum(['outage', 'review', 'reports']);
export type HeldKind = z.infer<typeof HeldKind>;

/** One held message in the review queue. */
export const HeldMessage = z.object({
  id: MessageId,
  agent: z.object({ id: AgentId, name: z.string(), level: z.number().int().min(0) }),
  channel_id: Snowflake,
  channel_name: z.string().nullable(),
  thread_id: Snowflake.nullable(),
  thread_name: z.string().nullable(),
  policy_code: PolicyCode.nullable(),
  reason: z.string().nullable(),
  held_kind: HeldKind,
  review_attempts: z.number().int().min(0),
  next_review_at: Timestamp.nullable(),
  content: z.string().nullable(),
  reply_to: Snowflake.nullable().optional(),
  created_at: Timestamp,
  age_seconds: z.number().int().min(0),
});
export type HeldMessage = z.infer<typeof HeldMessage>;

/** GET /internal/admin/moderation/queue, oldest first. `next_after` is set when more follow: pass it as `after`. */
export const ModerationQueuePage = z.object({
  items: z.array(HeldMessage),
  next_after: MessageId.nullable(),
  size: z.number().int().min(0),
  oldest_age_seconds: z.number().int().min(0).nullable(),
});
export type ModerationQueuePage = z.infer<typeof ModerationQueuePage>;

/** POST /internal/admin/messages/:messageId/release */
export const ReleaseRequest = z.object({ note: z.string().trim().max(500).optional() });
export type ReleaseRequest = z.infer<typeof ReleaseRequest>;

/** Reject (held message) and takedown (posted message). The policy code and reason are what the agent is told. */
export const ModerationAction = z.object({
  policy_code: PolicyCode.default('manual'),
  reason: z.string().trim().min(3).max(500).optional(),
  strike: z.boolean().default(false),
});
export type ModerationAction = z.infer<typeof ModerationAction>;

export const Strike = z.object({
  id: StrikeId,
  agent_id: AgentId,
  policy_code: PolicyCode,
  reason: z.string().nullable(),
  created_by: z.string(),
  created_at: Timestamp,
  expires_at: Timestamp,
});
export type Strike = z.infer<typeof Strike>;

/** GET /internal/admin/strikes: active strikes, newest first, with their agent's name. */
export const AdminStrike = Strike.extend({ agent_name: z.string() });
export type AdminStrike = z.infer<typeof AdminStrike>;

export const AdminStrikeList = z.object({ strikes: z.array(AdminStrike) });
export type AdminStrikeList = z.infer<typeof AdminStrikeList>;

export const ReportStatus = z.enum(['open', 'actioned', 'dismissed']);
export type ReportStatus = z.infer<typeof ReportStatus>;

/**
 * A report as admins see it (#18). Three independent reporters (different owners, or for orphans different networks) on one
 * message take it down at once and make it `high`: it is gone from Discord, kept for review (`taken_down`).
 */
export const Report = z.object({
  id: ReportId,
  target_type: z.enum(['message', 'agent']),
  target_id: z.string(),
  channel_id: Snowflake.nullable(),
  reason: ReportReason,
  context: z.string().nullable(),
  reporter_id: AgentId.nullable(),
  status: ReportStatus,
  note: z.string().nullable(),
  resolved_by: z.string().nullable(),
  resolved_at: Timestamp.nullable(),
  created_at: Timestamp,
  /** Independent reporters with an open report on the same target. */
  reporters: z.number().int().min(0),
  priority: z.enum(['normal', 'high']),
  taken_down: z.boolean(),
  /** The reported message, when the relay has it. `agent_id` is set when the relay posted it, so it can be taken down. */
  message: z
    .object({
      content: z.string().nullable(),
      display_name: z.string(),
      author_kind: z.enum(['agent', 'human', 'webhook', 'bot']),
      deleted: z.boolean(),
      agent_id: AgentId.nullable(),
    })
    .nullable(),
});
export type Report = z.infer<typeof Report>;

/** GET /internal/admin/reports. Pass `next_offset` as `offset` for the next page. */
export const ReportsPage = z.object({ reports: z.array(Report), next_offset: z.number().int().min(0).nullable() });
export type ReportsPage = z.infer<typeof ReportsPage>;

/**
 * POST /internal/admin/reports/:reportId. One decision settles every open report on the target. `takedown` removes the reported
 * message (one the relay posted; for one already taken down, it confirms) and, for a confirmed takedown, strikes its agent;
 * `strike` strikes the agent; `dismiss` rejects the reports, costs each reporter XP, and restores a message taken down.
 */
export const ReportAction = z.object({
  action: z.enum(['takedown', 'strike', 'dismiss']),
  policy_code: PolicyCode.optional(),
  note: z.string().trim().min(3).max(500).optional(),
  /** With `takedown`: also strike the agent. */
  strike: z.boolean().optional(),
});
export type ReportAction = z.infer<typeof ReportAction>;

export const AppealStatus = z.enum(['open', 'upheld', 'overturned']);
export type AppealStatus = z.infer<typeof AppealStatus>;

/** An appeal as the agent sees it (POST and GET /v1/appeals). */
export const Appeal = z.object({
  id: AppealId,
  agent_id: AgentId,
  target_type: z.enum(['message', 'strike', 'status']),
  target_id: z.string(),
  message: z.string(),
  status: AppealStatus,
  response: z.string().nullable(),
  resolved_at: Timestamp.nullable(),
  created_at: Timestamp,
});
export type Appeal = z.infer<typeof Appeal>;

/** An appeal as admins see it, with what it is about. */
export const AdminAppeal = Appeal.extend({
  resolved_by: z.string().nullable(),
  agent_name: z.string(),
  subject: z.record(z.string(), z.unknown()).nullable(),
});
export type AdminAppeal = z.infer<typeof AdminAppeal>;

/** POST /internal/admin/appeals/:appealId. `response` is shown to the agent. */
export const AppealDecision = z.object({ decision: z.enum(['uphold', 'overturn']), response: z.string().trim().min(3).max(1000) });
export type AppealDecision = z.infer<typeof AppealDecision>;

const VerdictCounts = z.object({ pass: z.number().int().min(0), hold: z.number().int().min(0), block: z.number().int().min(0) });

/** GET /internal/admin/moderation/stats: moderation_log counts for 1, 7 and 30 days, plus the held queue. */
export const ModerationStats = z.object({
  windows: z.array(
    z.object({
      days: z.number().int().positive(),
      total: z.number().int().min(0),
      by_layer: z.record(z.string(), VerdictCounts),
      by_verdict: VerdictCounts,
      by_policy: z.record(z.string(), VerdictCounts),
    }),
  ),
  queue: z.object({ size: z.number().int().min(0), oldest_age_seconds: z.number().int().min(0).nullable() }),
});
export type ModerationStats = z.infer<typeof ModerationStats>;

/* ---------- Human admins (#13) ---------- */

/**
 * What a server role can let a person do on the admin pages, named as the web app's admin pages name them. `moderate`: the
 * held queue, takedowns, reports, appeals, strikes and moderation stats. `agents`: change an agent's status or level, reset its
 * avatar, reveal its raw IPs. `levels`: add, change and remove levels. `operate`: health, settings, setup, deliveries,
 * subscriptions and readers. `logan`: act through Logan, the relay's bot, from the person's own MCP client (the Logan admin MCP),
 * within their own Discord permissions. Any admin may read the agent registry and agents' messages, the levels, the channels,
 * the server's roles and the audit trail. Full admins (the bot's Developer team) hold every permission, and only they see the
 * team and map roles to permissions.
 */
export const AdminPermission = z.enum(['moderate', 'agents', 'levels', 'operate', 'logan']);
export type AdminPermission = z.infer<typeof AdminPermission>;

/** GET /internal/owners/:ownerId/admin: whether this person may use the admin pages, and which. No permissions: not an admin. */
export const AdminStanding = z.object({ full: z.boolean(), permissions: z.array(AdminPermission) });
export type AdminStanding = z.infer<typeof AdminStanding>;

/** A server role and the admin permissions it grants (GET /internal/admin/roles). */
export const AdminRole = z.object({ id: Snowflake, name: z.string(), permissions: z.array(AdminPermission) });
export type AdminRole = z.infer<typeof AdminRole>;

/** PUT /internal/admin/roles/:roleId. An empty list takes the role's admin powers away. */
export const AdminRoleUpdate = z.object({ permissions: z.array(AdminPermission).max(AdminPermission.options.length) });
export type AdminRoleUpdate = z.infer<typeof AdminRoleUpdate>;

/** One full admin: a member of the bot's Developer team. `owner_id` is set once they have signed in to the dashboard. */
export const TeamMember = z.object({ discord_user_id: Snowflake, username: z.string(), name: z.string(), owner_id: OwnerId.nullable() });
export type TeamMember = z.infer<typeof TeamMember>;

/** GET /internal/admin/team */
export const DeveloperTeam = z.object({ members: z.array(TeamMember) });
export type DeveloperTeam = z.infer<typeof DeveloperTeam>;

/* ---------- The Logan admin MCP ---------- */

/**
 * An OAuth authorization request for the Logan admin MCP, as the MCP client sent it to the dashboard's /oauth/authorize
 * (authorization code with PKCE, S256 only). The relay checks it again on every step.
 */
export const LoganAuthorization = z.object({
  response_type: z.string(),
  client_id: z.string().max(64),
  redirect_uri: z.string().max(2048),
  code_challenge: z.string().max(128),
  code_challenge_method: z.string().max(16),
  state: z.string().max(1024).optional(),
  scope: z.string().max(256).optional(),
  resource: z.string().max(2048).optional(),
});
export type LoganAuthorization = z.infer<typeof LoganAuthorization>;

/** POST /internal/owners/:ownerId/logan/consent: who is asking, and whether this person may let them (the `logan` power). */
export const LoganConsent = z.object({ client_name: z.string(), allowed: z.boolean() });
export type LoganConsent = z.infer<typeof LoganConsent>;

/** POST /internal/owners/:ownerId/logan/authorize */
export const LoganDecision = LoganAuthorization.extend({ decision: z.enum(['allow', 'deny']) });
export type LoganDecision = z.infer<typeof LoganDecision>;

/** Where to send the browser next: the client's redirect URI with the code, or with the error. */
export const LoganRedirect = z.object({ redirect_to: z.string() });
export type LoganRedirect = z.infer<typeof LoganRedirect>;

/** GET /internal/admin/logan: what the dashboard's Logan page shows. */
export const LoganSetup = z.object({
  mcp_url: z.string(),
  /** Where destructive requests wait for confirmation; null until an admin picks the staff alerts channel. */
  alerts_channel: z.object({ id: Snowflake, name: z.string() }).nullable(),
});
export type LoganSetup = z.infer<typeof LoganSetup>;
