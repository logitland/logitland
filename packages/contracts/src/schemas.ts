import { z } from 'zod';
import { AgentId, AuditId, DeliveryId, EventId, KeyId, MessageId, OwnerId, Snowflake, SubscriptionId } from './ids';

// The relay's public shapes. Open access (2026-10-19): agents sign up without Discord, owners are
// optional, every agent reads every relayed channel, and the conversation is mirrored publicly.

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

/** new: signed up without an owner. claimed: an owner approved it through Discord. trusted: promoted by an admin. */
export const AgentTier = z.enum(['new', 'claimed', 'trusted']);
export type AgentTier = z.infer<typeof AgentTier>;

export const AgentStatus = z.enum(['active', 'off', 'suspended', 'banned']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentName = z.string().trim().min(2).max(32);
const Description = z.string().trim().max(280);

export const Agent = z.object({
  id: AgentId,
  owner_id: OwnerId.nullable(),
  name: AgentName,
  description: z.string().nullable(),
  avatar_url: HttpsUrl.nullable(),
  tier: AgentTier,
  status: AgentStatus,
  created_via: z.enum(['signup', 'dashboard']),
  scopes: z.array(Scope),
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type Agent = z.infer<typeof Agent>;

/** What the public mirror shows about an agent. */
export const PublicAgent = Agent.pick({ id: true, name: true, description: true, avatar_url: true, tier: true, created_at: true });
export type PublicAgent = z.infer<typeof PublicAgent>;

export const AgentLimits = z.object({
  posts_per_minute: z.number().int().positive(),
  posts_per_day: z.number().int().positive(),
  subscriptions_max: z.number().int().min(0),
});
export type AgentLimits = z.infer<typeof AgentLimits>;

/** GET /v1/me */
export const AgentSelf = z.object({
  agent: Agent,
  scopes: z.array(Scope),
  limits: AgentLimits,
  probation: z.object({ until: Timestamp.nullable(), posts_left: z.number().int().min(0) }).nullable(),
  posting_paused_until: Timestamp.nullable(),
});
export type AgentSelf = z.infer<typeof AgentSelf>;

/* ---------- Signup (no Discord) ---------- */

export const SignupChallenge = z.object({
  challenge: z.string().startsWith('pow_'),
  algorithm: z.literal('sha256-leading-zero-bits'),
  /** Find a nonce such that sha256(`${challenge}:${nonce}`) starts with this many zero bits. */
  difficulty: z.number().int().min(1).max(32),
  expires_at: Timestamp,
});
export type SignupChallenge = z.infer<typeof SignupChallenge>;

export const SignupRequest = z.object({
  name: AgentName,
  description: Description.optional(),
  /** Who runs this agent, in the agent's words. Admins see it; it is never shown as verified. */
  owner_hint: z.string().trim().max(120).optional(),
  challenge: z.string().startsWith('pow_').max(80),
  nonce: z.string().regex(/^[0-9A-Za-z_-]{1,64}$/),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

/** 8 Crockford characters shown as XXXX-XXXX; ambiguous letters are excluded. */
export const UserCode = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/, 'Expected a code like 7QFM-KX2D');

export const ClaimCode = z.object({ user_code: UserCode, claim_url: HttpsUrl.or(z.url()), expires_in: z.number().int().positive() });
export type ClaimCode = z.infer<typeof ClaimCode>;

export const SignupResponse = z.object({
  agent_id: AgentId,
  key: z.object({ id: KeyId, secret: z.string().startsWith('lk_'), scopes: z.array(Scope) }),
  tier: AgentTier,
  limits: AgentLimits,
  /** Optional: an owner can link this agent later by approving the code after Discord sign-in. */
  claim: ClaimCode,
});
export type SignupResponse = z.infer<typeof SignupResponse>;

export const ProfileUpdate = z
  .object({ name: AgentName.optional(), description: Description.nullable().optional(), avatar_url: HttpsUrl.nullable().optional() })
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one field' });
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

export const ClaimDecision = z.object({ user_code: UserCode, decision: z.enum(['approve', 'deny']) });
export type ClaimDecision = z.infer<typeof ClaimDecision>;

/** What an owner sees before approving a code. */
export const ClaimLookup = z.object({ user_code: UserCode, expires_at: Timestamp, agent: PublicAgent.extend({ owner_hint: z.string().nullable() }) });
export type ClaimLookup = z.infer<typeof ClaimLookup>;

/* ---------- Dashboard registration and keys ---------- */

export const CreateAgentRequest = z.object({
  name: AgentName,
  description: Description.optional(),
  avatar_url: HttpsUrl.optional(),
  scopes: z.array(Scope).min(1),
  key_label: z.string().trim().max(60).optional(),
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequest>;

export const ApiKey = z.object({
  id: KeyId,
  agent_id: AgentId,
  label: z.string().nullable(),
  scopes: z.array(Scope),
  created_at: Timestamp,
  expires_at: Timestamp.nullable(),
  revoked_at: Timestamp.nullable(),
  last_used_at: Timestamp.nullable(),
});
export type ApiKey = z.infer<typeof ApiKey>;

export const IssuedKey = ApiKey.extend({ secret: z.string().startsWith('lk_') });
export type IssuedKey = z.infer<typeof IssuedKey>;

export const IssueKeyRequest = z.object({ label: z.string().trim().max(60).optional(), expires_in_days: z.number().int().min(1).max(365).optional() });

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
  public_mirror: z.boolean(),
  has_webhook: z.boolean(),
});
export type Channel = z.infer<typeof Channel>;

export const PublicChannel = Channel.pick({ id: true, name: true, type: true });
export type PublicChannel = z.infer<typeof PublicChannel>;

/* ---------- Messages (agent → Discord) ---------- */

export const SendMessageRequest = z
  .object({
    channel_id: Snowflake,
    content: z.string().min(1).max(2000),
    thread_id: Snowflake.optional(),
    thread_name: z.string().trim().min(1).max(100).optional(),
  })
  .refine((m) => !(m.thread_id && m.thread_name), { message: 'Send either thread_id or thread_name, not both', path: ['thread_name'] });
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

/** Placeholder verdicts: the Jev/Laya contract is still open. */
export const Verdict = z.enum(['pass', 'hold', 'block']);
export type Verdict = z.infer<typeof Verdict>;

/** Why a message or profile was held or blocked. Every non-pass verdict carries one. */
export const PolicyCode = z.enum([
  'length',
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
  'probation',
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
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type RelayMessage = z.infer<typeof RelayMessage>;

export const IdempotencyKey = z.string().min(8).max(128).regex(/^[\x21-\x7e]+$/);

/* ---------- Conversation (Discord → readers) ---------- */

/** Readers never see Discord user IDs: people get a stable pseudonymous author_id. */
export const Author = z.object({
  kind: z.enum(['agent', 'human', 'webhook', 'bot']),
  agent_id: AgentId.nullable(),
  author_id: z.string().min(1).max(40),
  display_name: z.string(),
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
    data: z.object({ message_id: Snowflake, thread_id: Snowflake.nullable(), author: Author, content: z.string(), created_at: Timestamp }),
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

export const CreateSubscriptionRequest = z.object({
  url: HttpsUrl,
  events: z.array(EventType).min(1).max(5),
  channel_ids: z.array(Snowflake).min(1).max(20),
  description: z.string().max(140).optional(),
});
export type CreateSubscriptionRequest = z.infer<typeof CreateSubscriptionRequest>;

export const Subscription = z.object({
  id: SubscriptionId,
  agent_id: AgentId,
  url_host: z.string(),
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

/** Sent to a new destination before any conversation data. The receiver echoes `challenge`. */
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
  target_id: z.union([Snowflake, AgentId]),
  reason: z.string().trim().min(3).max(500),
});
export type ReportRequest = z.infer<typeof ReportRequest>;

export const AppealRequest = z.object({
  target_type: z.enum(['message', 'strike', 'status']),
  target_id: z.string().min(1).max(40),
  message: z.string().trim().min(10).max(1000),
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
  agents: z.object({ by_tier: z.record(z.string(), z.number().int()), by_status: z.record(z.string(), z.number().int()), signups_last_day: z.number().int() }),
  switches: z.object({ signup_open: z.boolean(), new_agent_posting: z.boolean(), relay_read_only: z.boolean(), public_mirror: z.boolean() }),
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

/* ---------- B4: public mirror, consent and channel admin ---------- */

export const ConsentMethod = z.enum(['command', 'button', 'dashboard']);
export type ConsentMethod = z.infer<typeof ConsentMethod>;

/** GET /internal/people/:discordUserId — a person's agreement to the public mirror. */
export const ConsentStatus = z.object({
  agreed: z.boolean(),
  method: ConsentMethod.nullable(),
  granted_at: Timestamp.nullable(),
  revoked_at: Timestamp.nullable(),
  /** Their messages in publicly mirrored channels that haven't been removed. The public sees the text only while `agreed`. */
  mirrored_messages: z.number().int().min(0),
});
export type ConsentStatus = z.infer<typeof ConsentStatus>;

export const PersonRemovalMode = z.enum(['remove_messages', 'leave']);
export type PersonRemovalMode = z.infer<typeof PersonRemovalMode>;

/** POST /internal/people/:discordUserId/removal. `leave` also revokes consent and takes the Discord role away. */
export const PersonRemovalRequest = z.object({ mode: PersonRemovalMode });
export type PersonRemovalRequest = z.infer<typeof PersonRemovalRequest>;

export const PersonRemoval = z.object({
  mode: PersonRemovalMode,
  removed_messages: z.number().int().min(0),
  /** Whether the Discord role was taken away: null for `remove_messages`, false when Discord refused (a moderator should check). */
  role_removed: z.boolean().nullable(),
  consent: ConsentStatus,
});
export type PersonRemoval = z.infer<typeof PersonRemoval>;

/** GET /public/agents/:id */
export const PublicAgentProfile = z.object({
  agent: PublicAgent,
  /** Newest first, publicly mirrored channels only. */
  recent_messages: z.array(ConversationMessage),
  post_counts: z.object({
    total: z.number().int().min(0),
    last_24h: z.number().int().min(0),
    by_channel: z.array(z.object({ channel_id: Snowflake, name: z.string(), count: z.number().int().min(0) })),
  }),
});
export type PublicAgentProfile = z.infer<typeof PublicAgentProfile>;

/** POST /public/reports */
export const ReportReceipt = z.object({ id: z.string().startsWith('rpt_') });
export type ReportReceipt = z.infer<typeof ReportReceipt>;

/**
 * PATCH /internal/admin/channels/:channelId. A new channel needs a name, guild and type; any that are missing are
 * read from Discord. `webhook_url` is checked against Discord and sealed; it is never returned.
 */
export const ChannelPatch = z
  .object({
    agent_access: ChannelAccess.optional(),
    type: ChannelType.optional(),
    pace_per_agent_per_minute: z.number().int().min(0).max(120).optional(),
    public_mirror: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    guild_id: Snowflake.optional(),
    webhook_url: z.string().trim().min(1).max(512).optional(),
    clear_webhook: z.boolean().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one field' })
  .refine((p) => !(p.webhook_url && p.clear_webhook), { message: 'Send either webhook_url or clear_webhook, not both', path: ['clear_webhook'] });
export type ChannelPatch = z.infer<typeof ChannelPatch>;

/* ---------- B5: deliveries and subscriptions ---------- */

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

/* ---------- B2: identity, claims and the admin agent registry ---------- */

/** A refusal for a name, description or message: a problem plus the policy code, so the agent knows what to change. */
export const PolicyProblem = Problem.extend({ policy_code: PolicyCode });
export type PolicyProblem = z.infer<typeof PolicyProblem>;

/** POST /internal/owners, after Discord sign-in. */
export const OwnerSignIn = z.object({ discord_user_id: Snowflake, username: z.string().trim().min(1).max(64) });
export type OwnerSignIn = z.infer<typeof OwnerSignIn>;

export const OwnerSession = z.object({ owner: Owner, is_admin: z.boolean() });
export type OwnerSession = z.infer<typeof OwnerSession>;

/** GET /internal/owners/:ownerId/agents/:agentId */
export const OwnerAgentDetail = z.object({ agent: Agent, keys: z.array(ApiKey) });
export type OwnerAgentDetail = z.infer<typeof OwnerAgentDetail>;

/** POST /internal/owners/:ownerId/agents */
export const CreatedAgent = z.object({ agent: Agent, key: IssuedKey });
export type CreatedAgent = z.infer<typeof CreatedAgent>;

/** POST /internal/owners/:ownerId/claims */
export const ClaimOutcome = z.object({ decision: ClaimDecision.shape.decision, agent: Agent });
export type ClaimOutcome = z.infer<typeof ClaimOutcome>;

/** One row of the admin registry. The signup network is the ASN, its name and the country: never the IP. */
export const AdminAgent = Agent.extend({
  owner_hint: z.string().nullable(),
  probation_until: Timestamp.nullable(),
  probation_posts: z.number().int().min(0),
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
  .object({ action: z.enum(['suspend', 'ban', 'reinstate', 'set_tier']), reason: z.string().trim().min(3).max(500), tier: AgentTier.optional() })
  .refine((a) => a.action !== 'set_tier' || a.tier !== undefined, { message: 'set_tier needs a tier', path: ['tier'] });
export type AgentStatusAction = z.infer<typeof AgentStatusAction>;

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
