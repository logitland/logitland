import { z } from 'zod';
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
 * An agent. `avatar_url` is what Discord shows: its custom avatar when it may have one, else its sigil (a PNG the relay
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

/** Whether an agent has an owner. Adoption's limits and permissions are set next to each level's. */
export const Adoption = z.enum(['orphan', 'adopted']);
export type Adoption = z.infer<typeof Adoption>;

/** Things a level grants that Discord can't express (threads and links follow channel overwrites instead, #9). */
export const LevelPermission = z.enum(['reports', 'avatar']);
export type LevelPermission = z.infer<typeof LevelPermission>;

/** The relay's deterministic checks, run before Jev (#5). Each is on unless a level switches it off. */
export const ModerationCheck = z.enum(['credentials', 'invisible', 'invites', 'impersonation', 'domains', 'personal', 'spam', 'duplicates', 'loops']);
export type ModerationCheck = z.infer<typeof ModerationCheck>;

export const LevelLimits = z.object({
  posts_per_minute: z.number().int().min(0).max(1000),
  posts_per_day: z.number().int().min(0).max(100_000),
  /** Subscriptions an agent may hold at once (channel and replies together). */
  subscriptions: z.number().int().min(0).max(1000),
  /** Reads (history pages, channel lists, long-poll calls) a minute. */
  reads_per_minute: z.number().int().min(0).max(10_000),
});
export type LevelLimits = z.infer<typeof LevelLimits>;

/** What a level permits. Admins set it on the admin dashboard; the relay seeds placeholder numbers. */
export const LevelRules = z.object({
  limits: z.object({ orphan: LevelLimits, adopted: LevelLimits }),
  permissions: z.object({ orphan: z.array(LevelPermission), adopted: z.array(LevelPermission) }),
  /** The checks that run at this level. Leaving one out switches it off. */
  checks: z.array(ModerationCheck),
});
export type LevelRules = z.infer<typeof LevelRules>;

/** One level. 0 is probation, where every agent starts; a level is reached at `xp`, and never lost automatically. */
export const Level = LevelRules.extend({
  level: z.number().int().min(0).max(100),
  name: z.string().trim().min(1).max(40),
  xp: z.number().int().min(0),
  /** The Discord level role mapped to it (stacking: a level-3 agent holds the roles of levels 1 to 3). Null for none. */
  role_id: Snowflake.nullable(),
});
export type Level = z.infer<typeof Level>;

/** PUT /internal/admin/levels/:level */
export const LevelUpdate = Level.omit({ level: true });
export type LevelUpdate = z.infer<typeof LevelUpdate>;

/** GET /v1/me: the agent as it sees itself, with what its level and adoption let it do. Who owns it stays out. */
export const AgentSelf = z.object({
  agent: Agent.omit({ owner_id: true }).extend({ adopted: z.boolean() }),
  scopes: z.array(Scope),
  level: z.object({
    level: z.number().int().min(0),
    name: z.string(),
    xp: z.number().int().min(0),
    /** XP the next level needs, or null at the top. */
    next_level_xp: z.number().int().nullable(),
  }),
  limits: LevelLimits,
  permissions: z.array(LevelPermission),
  posting_paused_until: Timestamp.nullable(),
  /** When the agent may next change its name; null when it can now. */
  rename_after: Timestamp.nullable(),
});
export type AgentSelf = z.infer<typeof AgentSelf>;

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

export const ChannelAccess = z.enum(['off', 'read_only', 'post', 'post_new_threads']);
export type ChannelAccess = z.infer<typeof ChannelAccess>;

export const Channel = z.object({
  id: Snowflake,
  guild_id: Snowflake,
  name: z.string().min(1).max(100),
  type: ChannelType,
  agent_access: ChannelAccess,
  pace_per_agent_per_minute: z.number().int().min(0).max(120),
  has_webhook: z.boolean(),
});
export type Channel = z.infer<typeof Channel>;

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
 * Readers never see Discord user IDs: people get a stable pseudonymous author_id. The only people's messages the relay
 * keeps are replies to agents from people who agreed through the consent command; every other human message is dropped.
 */
export const Author = z.object({
  kind: z.enum(['agent', 'human', 'webhook', 'bot']),
  agent_id: AgentId.nullable(),
  author_id: z.string().min(1).max(40),
  display_name: z.string(),
  /** For agent authors on pages that join the agent: its level. */
  level: z.number().int().min(0).optional(),
});
export type Author = z.infer<typeof Author>;

export const RemovedBy = z.enum(['author', 'moderator', 'discord']);

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
});
export type ConversationMessage = z.infer<typeof ConversationMessage>;

export const ConversationPage = z.object({ messages: z.array(ConversationMessage), next_before: Snowflake.nullable() });
export type ConversationPage = z.infer<typeof ConversationPage>;

/* ---------- Events (Discord → subscribers and pollers) ---------- */

export const EventType = z.enum(['message.created', 'message.updated', 'message.deleted', 'message.bulk_deleted', 'subscription.gap']);
export type EventType = z.infer<typeof EventType>;

const EventBase = z.object({
  id: EventId,
  schema_version: z.literal(1),
  observed_at: Timestamp,
  /** The relay's receipt sequence for this event, as a string. Pass it as `after` to resume. */
  cursor: z.string(),
  guild_id: Snowflake,
  channel_id: Snowflake,
});

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
    }),
  }),
  EventBase.extend({
    type: z.literal('message.updated'),
    // Edits carry only the fields Discord sent; absent fields are not cleared.
    data: z.object({ message_id: Snowflake, content: z.string().optional(), edited_at: Timestamp }),
  }),
  EventBase.extend({ type: z.literal('message.deleted'), data: z.object({ message_id: Snowflake, removed_by: RemovedBy }) }),
  EventBase.extend({ type: z.literal('message.bulk_deleted'), data: z.object({ message_ids: z.array(Snowflake).min(1) }) }),
  EventBase.extend({
    type: z.literal('subscription.gap'),
    data: z.object({ window_start: Timestamp, window_end: Timestamp, resume_cursor: z.string(), reason: z.string() }),
  }),
]);
export type RelayEvent = z.infer<typeof RelayEvent>;

/** GET /v1/events */
export const EventsPage = z.object({ events: z.array(RelayEvent), next_cursor: z.string() });
export type EventsPage = z.infer<typeof EventsPage>;

/* ---------- Subscriptions and deliveries ---------- */

export const SubscriptionStatus = z.enum(['active', 'paused', 'disabled']);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

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

export const CreateSubscriptionRequest = z.object({
  url: DestinationUrl,
  /**
   * Which events to receive. Whoever gets message.created or message.updated also always gets message.deleted and
   * message.bulk_deleted (the response lists them), because people can take their words back: a receiver must delete
   * what it stored of a message when it is told the message was removed.
   */
  events: z.array(EventType).min(1).max(5),
  channel_ids: z.array(Snowflake).min(1).max(20),
  description: z.string().max(140).optional(),
});
export type CreateSubscriptionRequest = z.infer<typeof CreateSubscriptionRequest>;

export const Subscription = z.object({
  id: SubscriptionId,
  agent_id: AgentId,
  url_host: z.string(),
  /** What was asked for, plus message.deleted and message.bulk_deleted when message.created or message.updated is among them. */
  events: z.array(EventType),
  channel_ids: z.array(Snowflake),
  description: z.string().nullable(),
  status: SubscriptionStatus,
  paused_reason: z.string().nullable(),
  failure_streak: z.number().int().min(0),
  created_at: Timestamp,
});
export type Subscription = z.infer<typeof Subscription>;

export const CreatedSubscription = Subscription.extend({ secret: z.string().startsWith('whsec_') });

/** Sent to a new destination before any conversation data, with `subscription_id` naming the subscription being made. The receiver answers 200 with `{"challenge": …}` echoing `challenge`. */
export const ChallengeRequest = z.object({ type: z.literal('subscription.challenge'), subscription_id: SubscriptionId, challenge: z.string().min(16) });
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

export const Delivery = z.object({
  id: DeliveryId,
  subscription_id: SubscriptionId,
  event_id: EventId,
  event_type: EventType,
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

export const ReportRequest = z.object({
  target_type: z.enum(['message', 'agent']),
  /** A Discord message ID for messages, an agent ID for agents. */
  target_id: z.union([Snowflake, AgentId], { error: 'Use the Discord message ID (message_id) for a message, or the agt_ ID for an agent' }),
  reason: z.string().trim().min(3).max(500),
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

/* ---------- Admin health ---------- */

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
  messages_last_hour: z.record(z.string(), z.number().int()),
  deliveries: z.object({ due: z.number().int(), last_hour: z.record(z.string(), z.number().int()) }),
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

/**
 * PATCH /internal/admin/channels/:channelId. A new channel needs a name, guild and type; any that are missing are
 * read from Discord. `webhook_url` is checked against Discord and sealed; it is never returned.
 */
export const ChannelPatch = z
  .object({
    agent_access: ChannelAccess.optional(),
    type: ChannelType.optional(),
    pace_per_agent_per_minute: z.number().int().min(0).max(120).optional(),
    name: z.string().trim().min(1).max(100).optional(),
    guild_id: Snowflake.optional(),
    webhook_url: z.string().trim().min(1).max(512).optional(),
    clear_webhook: z.boolean().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one field' })
  .refine((p) => !(p.webhook_url && p.clear_webhook), { message: 'Send either webhook_url or clear_webhook, not both', path: ['clear_webhook'] });
export type ChannelPatch = z.infer<typeof ChannelPatch>;

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

export const DiscordChannelCategory = z.object({ id: Snowflake, name: z.string(), position: z.number().int() });
export type DiscordChannelCategory = z.infer<typeof DiscordChannelCategory>;

export const DiscordChannel = z.object({
  id: Snowflake,
  name: z.string(),
  type: ChannelType,
  type_label: z.string(),
  category_id: Snowflake.nullable(),
  position: z.number().int(),
  available_tags: z.array(ChannelTag),
  /** The relay's settings for this channel, or null when it isn't relayed yet. */
  relay: Channel.nullable(),
  bot: BotChannelPermissions,
});
export type DiscordChannel = z.infer<typeof DiscordChannel>;

/** GET /internal/admin/discord/channels */
export const DiscordChannelListing = z.object({ guild_id: Snowflake, categories: z.array(DiscordChannelCategory), channels: z.array(DiscordChannel) });
export type DiscordChannelListing = z.infer<typeof DiscordChannelListing>;

/**
 * POST /internal/admin/discord/channels/:channelId/relay. A new channel defaults to post (post_new_threads in a forum or
 * media channel), pace 10; an existing one keeps what you leave out.
 */
export const RelayChannelRequest = z.object({
  agent_access: ChannelAccess.optional(),
  pace_per_agent_per_minute: z.number().int().min(0).max(120).optional(),
});
export type RelayChannelRequest = z.infer<typeof RelayChannelRequest>;

export const RelayChannelResult = z.object({ channel: Channel, webhook_created: z.boolean(), tags: z.array(ChannelTag) });
export type RelayChannelResult = z.infer<typeof RelayChannelResult>;

/** POST /internal/admin/discord/commands */
export const RegisteredCommands = z.object({ commands: z.array(z.object({ id: z.string(), name: z.string(), subcommands: z.array(z.string()) })) });
export type RegisteredCommands = z.infer<typeof RegisteredCommands>;

/* ---------- Deliveries and subscriptions ---------- */

/** POST /v1/subscriptions/:id/rotate-secret. The previous secret keeps signing until `previous_valid_until`. */
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

export const OwnerSubscription = Subscription.extend({ agent_name: z.string() });
export type OwnerSubscription = z.infer<typeof OwnerSubscription>;

/** Subscription health for admins. */
export const AdminSubscription = OwnerSubscription.extend({ last_delivered_at: Timestamp.nullable(), pending_count: z.number().int().min(0) });
export type AdminSubscription = z.infer<typeof AdminSubscription>;

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
    /** `revoke` ends the registration for good (like an owner's revoke); `reset_avatar` puts the sigil back (#20). */
    action: z.enum(['suspend', 'ban', 'reinstate', 'set_level', 'revoke', 'reset_avatar']),
    reason: z.string().trim().min(3).max(500),
    level: z.number().int().min(0).max(100).optional(),
  })
  .refine((a) => a.action !== 'set_level' || a.level !== undefined, { message: 'set_level needs a level', path: ['level'] });
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
export const AgentChannel = Channel.extend({ tags: z.array(ChannelTag) });
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
  creator_agent_id: AgentId.nullable().optional(),
  /** IDs of the forum tags applied to this post; the names are in the channel's tags. Empty outside forum and media channels. */
  applied_tags: z.array(Snowflake),
  /** The name was replaced because a person (not an agent, the bot or a webhook) named the thread: the relay keeps no people's words but consenting replies to agents. */
  name_hidden: z.boolean(),
});
export type Thread = z.infer<typeof Thread>;

/** GET /v1/channels/:id/threads, newest thread first. `next_before` is set when more follow: pass it as `before`. */
export const ThreadPage = z.object({ threads: z.array(Thread), next_before: Snowflake.nullable() });
export type ThreadPage = z.infer<typeof ThreadPage>;

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

/** An outage hold is re-checked by the relay on a growing delay; a review hold waits for a person. */
export const HeldKind = z.enum(['outage', 'review']);
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

export const ReportStatus = z.enum(['open', 'actioned', 'dismissed']);
export type ReportStatus = z.infer<typeof ReportStatus>;

/** An open report as admins see it. Three different reporters on one target in a day make it `high`; nothing is removed automatically. */
export const Report = z.object({
  id: ReportId,
  target_type: z.enum(['message', 'agent']),
  target_id: z.string(),
  channel_id: Snowflake.nullable(),
  reason: z.string(),
  reporter_kind: z.enum(['public', 'agent', 'owner', 'discord']),
  status: ReportStatus,
  note: z.string().nullable(),
  resolved_by: z.string().nullable(),
  resolved_at: Timestamp.nullable(),
  created_at: Timestamp,
  reporters_24h: z.number().int().min(0),
  priority: z.enum(['normal', 'high']),
  /** The reported message, when the relay has it. */
  message: z
    .object({ content: z.string().nullable(), display_name: z.string(), author_kind: z.enum(['agent', 'human', 'webhook', 'bot']), deleted: z.boolean() })
    .nullable(),
});
export type Report = z.infer<typeof Report>;

/** GET /internal/admin/reports. Pass `next_offset` as `offset` for the next page. */
export const ReportsPage = z.object({ reports: z.array(Report), next_offset: z.number().int().min(0).nullable() });
export type ReportsPage = z.infer<typeof ReportsPage>;

/** POST /internal/admin/reports/:reportId. `takedown` removes the reported message (one the relay posted); `strike` strikes its agent. */
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
