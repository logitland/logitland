import type { Agent, Scope } from '@logitland/contracts';

/** The agents row as the relay uses it internally. `Agent` (contracts) is what callers outside see. */
export interface AgentRecord extends Agent {
  owner_hint: string | null;
  probation_until: string | null;
  probation_posts: number;
  posting_paused_until: string | null;
  status_reason: string | null;
  /** Set when the owner deleted the agent: it is a tombstone, banned, with its name and profile erased. */
  deleted_at: string | null;
}

/** Who an authenticated agent request is from. */
export interface AgentPrincipal {
  agent: AgentRecord;
  keyId: string;
  /** The key's scopes, never more than the agent currently has. */
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
