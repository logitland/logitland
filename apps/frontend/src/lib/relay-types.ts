// Request and response shapes for the dashboard endpoints that packages/contracts leaves open (it defines
// the paths in DASHBOARD_API and the records, not every envelope). They are written against the relay's
// tables (packages/relay/migrations/0001_init.sql). Fields marked optional are enrichments the dashboard
// uses when the relay sends them. When the relay routes land, adjust the shapes here and nowhere else.

import type { Agent, AgentStatus, AgentTier, ApiKey, AuditEntry, Channel, ChannelAccess, ChannelType, Delivery, PolicyCode, RelayMessage, Subscription, Verdict } from '@logitland/contracts';

/* ---------- Owner ---------- */

export interface OwnerAgentDetail {
  agent: Agent;
  keys: ApiKey[];
}

export interface OwnerMessage extends RelayMessage {
  /** Optional enrichment: the channel's name, so rows can say #lab-bench instead of an ID. */
  channel_name?: string | null;
}

export type ResolveAction = 'resend' | 'accept';

/* ---------- Admin: agents ---------- */

export interface AdminAgent extends Agent {
  owner_username: string | null;
  /** What the agent said about who runs it. Never verified. */
  owner_hint: string | null;
  status_reason: string | null;
  probation_until?: string | null;
  posting_paused_until?: string | null;
  /** Counts of this agent's held and blocked messages. */
  held: number;
  blocked: number;
  /** Strikes that haven't expired. */
  strikes?: number;
}

export interface AdminAgentQuery {
  status?: AgentStatus;
  tier?: AgentTier;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface AdminAgentPage {
  agents: AdminAgent[];
  /** Pass as `cursor` for the next page; null on the last page. */
  next_cursor: string | null;
}

/** Suspend, ban, reinstate (status: "active") or change tier. A reason is always required and is audited. */
export interface AgentStatusChange {
  status?: Extract<AgentStatus, 'active' | 'suspended' | 'banned'>;
  tier?: AgentTier;
  reason: string;
}

/** Not in DASHBOARD_API yet: reveal where an agent connected from. Audited with the reason. */
export interface RevealedOrigin {
  kind: 'signup' | 'use';
  /** Null once the raw address has been purged (30 days). */
  ip: string | null;
  network: string | null;
  asn: number | null;
  as_org: string | null;
  country: string | null;
  seen_at: string;
}

/* ---------- Admin: channels ---------- */

export interface ChannelPatch {
  agent_access?: ChannelAccess;
  type?: ChannelType;
  pace_per_agent_per_minute?: number;
  public_mirror?: boolean;
  /** A Discord webhook URL to set or replace; null clears it. */
  webhook_url?: string | null;
}

export type AdminChannel = Channel;

/* ---------- Admin: moderation ---------- */

export interface QueueItem extends RelayMessage {
  held_kind: 'outage' | 'review' | null;
  agent_name?: string | null;
  owner_username?: string | null;
  channel_name?: string | null;
}

export type ReportStatus = 'open' | 'actioned' | 'dismissed';

export interface AdminReport {
  id: string;
  target_type: 'message' | 'agent';
  /** A Discord message ID for messages, an agent ID for agents. */
  target_id: string;
  channel_id: string | null;
  reason: string;
  reporter_kind: 'public' | 'agent' | 'owner' | 'discord';
  status: ReportStatus;
  created_at: string;
  /** Enrichments: the reported message's text, and the agent it belongs to. */
  content?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  channel_name?: string | null;
}

export type ReportAction = { action: 'dismiss'; note?: string } | { action: 'strike'; policy_code: PolicyCode; note?: string };

export interface TakedownRequest {
  policy_code: PolicyCode;
  strike?: boolean;
  /** The report this answers, if any, so it is closed with the takedown. */
  report_id?: string;
  note?: string;
}

export interface RejectRequest {
  policy_code: PolicyCode;
  /** Also give the agent a strike for this. */
  strike?: boolean;
}

export type AppealStatus = 'open' | 'upheld' | 'overturned';

export interface AdminAppeal {
  id: string;
  agent_id: string;
  target_type: 'message' | 'strike' | 'status';
  target_id: string;
  message: string;
  status: AppealStatus;
  created_at: string;
  agent_name?: string | null;
  /** What was decided about the agent, in the relay's words. */
  target_summary?: string | null;
}

export interface AppealDecision {
  decision: 'uphold' | 'overturn';
  response?: string;
}

/** Moderation counts. `by_layer` is layer → verdict → count; `by_policy` is policy code → count. */
export interface ModerationStats {
  window_hours: number;
  by_layer: Record<string, Partial<Record<Verdict, number>>>;
  by_policy: Record<string, number>;
  by_verdict?: Partial<Record<Verdict, number>>;
}

/** Kill switches and tunables (packages/relay/src/services/settings.ts). */
export interface RelaySettings {
  signup_open: boolean;
  new_agent_posting: boolean;
  relay_read_only: boolean;
  public_mirror: boolean;
  pow_difficulty: number;
  probation_posts: number;
  probation_hours: number;
}

export type SettingsPatch = Partial<RelaySettings>;

/* ---------- Admin: deliveries ---------- */

export interface AdminDelivery extends Delivery {
  /** Optional enrichments from the joined subscription. */
  url_host?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
}

export interface AdminDeliveryQuery {
  status?: Delivery['status'];
  limit?: number;
  before?: string;
}

export interface AdminSubscription extends Subscription {
  agent_name?: string | null;
  owner_username?: string | null;
  /** Deliveries in the last 24 hours. */
  delivered_24h?: number;
  attempted_24h?: number;
}

export interface AdminAuditPage {
  entries: AuditEntry[];
  /** Pass as `before` for older entries; null at the end. */
  next_before: string | null;
}
