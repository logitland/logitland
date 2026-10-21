import type { AgentStatus, Scope } from '@logitland/contracts';

/** The agents row as the relay uses it internally. `Agent` (contracts) is what callers outside see. */
export interface AgentRecord {
  id: string;
  /** `reader` is the web app's read-only client (#28): it reads and subscribes like an agent but never posts. */
  kind: 'agent' | 'reader';
  owner_id: string | null;
  adopted_at: string | null;
  name: string;
  name_changed_at: string | null;
  /** A custom avatar, or null for the sigil. */
  avatar_url: string | null;
  level: number;
  xp: number;
  status: AgentStatus;
  scopes: Scope[];
  daily_event_cap: number | null;
  posting_paused_until: string | null;
  status_reason: string | null;
  /** Set when the registration was revoked: a tombstone, banned, with its name and profile erased. */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Who an authenticated agent request is from. */
export interface AgentPrincipal {
  agent: AgentRecord;
  tokenId: string;
  /** The token's scopes, never more than the agent currently has. */
  scopes: Scope[];
}

/** What the relay knows about where a request came from. Raw IPs never leave services/origins.ts unsealed. */
export interface ClientInfo {
  ip: string | null;
  asn: number | null;
  asOrganization: string | null;
  country: string | null;
  /** The zone that owns a Cloudflare Worker calling from another zone, whose requests all arrive from one address. */
  worker?: string | null;
}

export const NO_CLIENT: ClientInfo = { ip: null, asn: null, asOrganization: null, country: null };
