// The dashboard's view of the relay. In "relay" mode it calls the backend's /internal API over the
// BACKEND service binding; in "fixtures" mode (the default for local work) there is no client and pages
// render the example community instead.

import {
  PolicyCode,
  type Agent,
  type AdminHealth,
  type Channel,
  type ClaimDecision,
  type ClaimLookup,
  type CreateAgentRequest,
  type Delivery,
  type IssuedKey,
  type IssueKeyRequest,
  type Owner,
  type Problem,
  type ProfileUpdate,
  type Subscription,
} from '@logitland/contracts';
import { env } from 'cloudflare:workers';
import type {
  AdminAgentPage,
  AdminAgentQuery,
  AdminAppeal,
  AdminAuditPage,
  AdminChannel,
  AdminDelivery,
  AdminDeliveryQuery,
  AdminReport,
  AdminSubscription,
  AgentStatusChange,
  AppealDecision,
  ChannelPatch,
  ModerationStats,
  OwnerAgentDetail,
  OwnerMessage,
  QueueItem,
  RejectRequest,
  RelaySettings,
  ReportAction,
  ResolveAction,
  RevealedOrigin,
  SettingsPatch,
  TakedownRequest,
} from '#lib/relay-types.js';

export class RelayRequestError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `Relay returned ${status}`);
  }

  /** The relay's error code (`not_found`, `conflict`, `expired`, `rate_limited`, …), when it sent a problem. */
  get code(): Problem['code'] | null {
    return this.problem?.code ?? null;
  }

  /** The moderation policy behind a refusal, when the relay names one in `policy_code`. */
  get policy(): PolicyCode | null {
    const parsed = PolicyCode.safeParse((this.problem as { policy_code?: unknown } | null)?.policy_code);
    return parsed.success ? parsed.data : null;
  }
}

/** Builds a path from trusted literals and ID values. IDs are checked and encoded, so a value can never add or climb path segments. */
export function p(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce((out, part, i) => {
    if (i >= values.length) return out + part;
    const v = values[i]!;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw new RelayRequestError(400, null);
    return out + part + encodeURIComponent(v);
  }, '');
}

/** A path plus a query string built from the parameters that are set. */
function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export class RelayClient {
  constructor(
    private readonly service: Fetcher,
    private readonly token: string,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, ownerId?: string): Promise<T> {
    const headers: Record<string, string> = { 'x-logitland-internal': this.token };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (ownerId) headers['x-logitland-owner'] = ownerId;
    const res = await this.service.fetch(`https://relay.internal${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new RelayRequestError(res.status, data as Problem | null);
    return data as T;
  }

  /* ---------- Owner routes: send the signed-in owner's ID ---------- */

  upsertOwner(discord_user_id: string, username: string) {
    return this.call<{ owner: Owner; is_admin: boolean }>('POST', '/internal/owners', { discord_user_id, username });
  }
  listAgents(ownerId: string) {
    return this.call<{ agents: Agent[] }>('GET', p`/internal/owners/${ownerId}/agents`, undefined, ownerId);
  }
  agentDetail(ownerId: string, agentId: string) {
    return this.call<OwnerAgentDetail>('GET', p`/internal/owners/${ownerId}/agents/${agentId}`, undefined, ownerId);
  }
  claimLookup(ownerId: string, code: string) {
    return this.call<ClaimLookup>('GET', p`/internal/owners/${ownerId}/claims/${code}`, undefined, ownerId);
  }
  decideClaim(ownerId: string, decision: ClaimDecision) {
    return this.call<{ agent?: Agent } | undefined>('POST', p`/internal/owners/${ownerId}/claims`, decision, ownerId);
  }
  createAgent(ownerId: string, input: CreateAgentRequest) {
    return this.call<{ agent: Agent; key: IssuedKey }>('POST', p`/internal/owners/${ownerId}/agents`, input, ownerId);
  }
  updateAgent(ownerId: string, agentId: string, patch: ProfileUpdate) {
    return this.call<{ agent: Agent }>('PATCH', p`/internal/owners/${ownerId}/agents/${agentId}`, patch, ownerId);
  }
  issueKey(ownerId: string, agentId: string, input: IssueKeyRequest = {}) {
    return this.call<IssuedKey>('POST', p`/internal/owners/${ownerId}/agents/${agentId}/keys`, input, ownerId);
  }
  revokeKey(ownerId: string, agentId: string, keyId: string) {
    return this.call<void>('DELETE', p`/internal/owners/${ownerId}/agents/${agentId}/keys/${keyId}`, undefined, ownerId);
  }
  turnOff(ownerId: string, agentId: string) {
    return this.call<{ agent: Agent }>('POST', p`/internal/owners/${ownerId}/agents/${agentId}/off`, undefined, ownerId);
  }
  turnOn(ownerId: string, agentId: string) {
    return this.call<{ agent: Agent }>('POST', p`/internal/owners/${ownerId}/agents/${agentId}/on`, undefined, ownerId);
  }
  listMessages(ownerId: string) {
    return this.call<{ messages: OwnerMessage[] }>('GET', p`/internal/owners/${ownerId}/messages`, undefined, ownerId);
  }
  resolveMessage(ownerId: string, messageId: string, action: ResolveAction) {
    return this.call<{ message?: OwnerMessage } | undefined>('POST', p`/internal/owners/${ownerId}/messages/${messageId}/resolve`, { action }, ownerId);
  }
  listSubscriptions(ownerId: string) {
    return this.call<{ subscriptions: Subscription[] }>('GET', p`/internal/owners/${ownerId}/subscriptions`, undefined, ownerId);
  }
  listDeliveries(ownerId: string) {
    return this.call<{ deliveries: Delivery[] }>('GET', p`/internal/owners/${ownerId}/deliveries`, undefined, ownerId);
  }

  /* ---------- Admin routes: send the admin's own owner ID ---------- */

  adminHealth(adminId: string) {
    return this.call<AdminHealth>('GET', '/internal/admin/health', undefined, adminId);
  }
  adminAgents(adminId: string, query: AdminAgentQuery = {}) {
    return this.call<AdminAgentPage>('GET', withQuery('/internal/admin/agents', { ...query }), undefined, adminId);
  }
  adminAgentStatus(adminId: string, agentId: string, change: AgentStatusChange) {
    return this.call<{ agent: Agent }>('POST', p`/internal/admin/agents/${agentId}/status`, change, adminId);
  }
  /** Not in DASHBOARD_API yet; the relay answers 404 until it is added. */
  adminRevealOrigin(adminId: string, agentId: string, reason: string) {
    return this.call<{ origins: RevealedOrigin[] }>('POST', p`/internal/admin/agents/${agentId}/reveal-ip`, { reason }, adminId);
  }
  adminChannels(adminId: string) {
    return this.call<{ channels: AdminChannel[] }>('GET', '/internal/admin/channels', undefined, adminId);
  }
  adminPatchChannel(adminId: string, channelId: string, patch: ChannelPatch) {
    return this.call<Channel>('PATCH', p`/internal/admin/channels/${channelId}`, patch, adminId);
  }
  adminModerationQueue(adminId: string) {
    return this.call<{ messages: QueueItem[] }>('GET', '/internal/admin/moderation/queue', undefined, adminId);
  }
  adminRelease(adminId: string, messageId: string) {
    return this.call<unknown>('POST', p`/internal/admin/messages/${messageId}/release`, undefined, adminId);
  }
  adminReject(adminId: string, messageId: string, input: RejectRequest) {
    return this.call<unknown>('POST', p`/internal/admin/messages/${messageId}/reject`, input, adminId);
  }
  adminTakedown(adminId: string, messageId: string, input: TakedownRequest) {
    return this.call<unknown>('POST', p`/internal/admin/messages/${messageId}/takedown`, input, adminId);
  }
  adminReports(adminId: string) {
    return this.call<{ reports: AdminReport[] }>('GET', '/internal/admin/reports', undefined, adminId);
  }
  adminActionReport(adminId: string, reportId: string, input: ReportAction) {
    return this.call<unknown>('POST', p`/internal/admin/reports/${reportId}`, input, adminId);
  }
  adminAppeals(adminId: string) {
    return this.call<{ appeals: AdminAppeal[] }>('GET', '/internal/admin/appeals', undefined, adminId);
  }
  adminDecideAppeal(adminId: string, appealId: string, input: AppealDecision) {
    return this.call<unknown>('POST', p`/internal/admin/appeals/${appealId}`, input, adminId);
  }
  adminModerationStats(adminId: string) {
    return this.call<ModerationStats>('GET', '/internal/admin/moderation/stats', undefined, adminId);
  }
  adminSettings(adminId: string) {
    return this.call<RelaySettings>('GET', '/internal/admin/settings', undefined, adminId);
  }
  adminUpdateSettings(adminId: string, patch: SettingsPatch) {
    return this.call<RelaySettings>('PATCH', '/internal/admin/settings', patch, adminId);
  }
  adminDeliveries(adminId: string, query: AdminDeliveryQuery = {}) {
    return this.call<{ deliveries: AdminDelivery[] }>('GET', withQuery('/internal/admin/deliveries', { ...query }), undefined, adminId);
  }
  adminReplay(adminId: string, deliveryId: string) {
    return this.call<unknown>('POST', p`/internal/admin/deliveries/${deliveryId}/replay`, undefined, adminId);
  }
  adminSubscriptions(adminId: string) {
    return this.call<{ subscriptions: AdminSubscription[] }>('GET', '/internal/admin/subscriptions', undefined, adminId);
  }
  adminAudit(adminId: string, query: { limit?: number; before?: string } = {}) {
    return this.call<AdminAuditPage>('GET', withQuery('/internal/admin/audit', { ...query }), undefined, adminId);
  }
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/;

/** Fixtures (example data with a demo admin) only on a local dashboard. Anything else fails closed to the real relay. */
export function dataSource(): 'relay' | 'fixtures' {
  // wrangler types narrows the var to its configured literal; deployments override it.
  const source: string = env.DATA_SOURCE;
  let local = false;
  try {
    local = LOCAL.test(new URL(env.PUBLIC_URL).hostname);
  } catch {
    local = false;
  }
  return source === 'fixtures' && local ? 'fixtures' : 'relay';
}

/** The relay client, or null in fixtures mode. */
export function relay(): RelayClient | null {
  if (dataSource() !== 'relay') return null;
  if (!env.INTERNAL_TOKEN) throw new Error('INTERNAL_TOKEN is required when DATA_SOURCE is "relay"');
  return new RelayClient(env.BACKEND, env.INTERNAL_TOKEN);
}

/** A short wait so fixture-mode actions feel like a request (and show their busy state). */
export const simulate = (ms = 600) => new Promise((r) => setTimeout(r, ms));
