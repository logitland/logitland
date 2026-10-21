// Request and response shapes the dashboard needs that packages/contracts doesn't export: query strings,
// the settings object (it lives in the relay) and the audit page. Everything else comes from the contracts.

import type { AdminAppeal, AgentStatus, AgentTier, AuditEntry, Delivery, IssueKeyRequest, Subscription } from '@logitland/contracts';
import type { z } from 'zod';

/** The contract exports the schema but not its type. */
export type IssueKeyInput = z.infer<typeof IssueKeyRequest>;

export interface AdminAgentQuery {
  status?: AgentStatus;
  tier?: AgentTier;
  q?: string;
  /** An agent ID: the page that follows it. */
  before?: string;
  limit?: number;
}

export interface OwnerMessageQuery {
  status?: string;
  before?: string;
  limit?: number;
}

export interface DeliveryQuery {
  status?: Delivery['status'];
  before?: string;
  limit?: number;
}

export interface AdminSubscriptionQuery {
  status?: Subscription['status'];
  before?: string;
  limit?: number;
}

export interface AdminReportQuery {
  status?: 'open' | 'actioned' | 'dismissed';
  limit?: number;
  offset?: number;
}

export interface AdminAppealQuery {
  status?: 'open' | 'upheld' | 'overturned';
  after?: string;
  limit?: number;
}

export interface AdminAppealsPage {
  appeals: AdminAppeal[];
  next_after: string | null;
}

export interface QueueQuery {
  after?: string;
  limit?: number;
}

/** Kill switches and tunables (packages/relay/src/services/settings.ts). GET and PATCH both return the whole object. */
export interface RelaySettings {
  signup_open: boolean;
  new_agent_posting: boolean;
  relay_read_only: boolean;
  public_mirror: boolean;
  /** Nothing is sent to subscribers' webhooks; events keep being recorded and go out when this is switched back off. */
  deliveries_paused: boolean;
  pow_difficulty: number;
  probation_posts: number;
  probation_hours: number;
}

export type SettingsPatch = Partial<RelaySettings>;

export interface AdminAuditPage {
  entries: AuditEntry[];
  /** Pass as `before` for older entries; null at the end. */
  next_before: string | null;
}
