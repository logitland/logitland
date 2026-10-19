// The dashboard's view of the relay. In "relay" mode it calls the backend's /internal API over the
// BACKEND service binding; in "fixtures" mode (the default for local work) there is no client and pages
// render the example community instead.

import {
  PolicyCode,
  type Agent,
  type AdminAgentsPage,
  type AdminHealth,
  type AdminSubscriptionsPage,
  type AgentStatusAction,
  type AppealDecision,
  type Channel,
  type ChannelPatch,
  type ClaimDecision,
  type ClaimLookup,
  type ClaimOutcome,
  type ConsentMessage,
  type CreateAgentRequest,
  type CreatedAgent,
  type DeliveryDetailsPage,
  type DiscordChannelListing,
  type HideMessageRequest,
  type HideMessageResult,
  type IssuedKey,
  type ModerationAction,
  type ModerationQueuePage,
  type ModerationStats,
  type OwnerAgentDetail,
  type OwnerMessagesPage,
  type OwnerSession,
  type OwnerSubscription,
  type Problem,
  type ProfileUpdate,
  type RelayMessage,
  type RegisteredCommands,
  type RelayChannelRequest,
  type RelayChannelResult,
  type ReleaseRequest,
  type ReplayResult,
  type Report,
  type ReportAction,
  type ReportsPage,
  type ResolveMessageRequest,
  type RevealIpResponse,
  type SetupReport,
  type AdminAppeal,
} from '@logitland/contracts';
import { env } from 'cloudflare:workers';
import type {
  AdminAgentQuery,
  AdminAppealQuery,
  AdminAppealsPage,
  AdminAuditPage,
  AdminReportQuery,
  AdminSubscriptionQuery,
  DeliveryQuery,
  IssueKeyInput,
  OwnerMessageQuery,
  QueueQuery,
  RelaySettings,
  SettingsPatch,
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

  private async call<T>(method: string, path: string, body?: unknown, ownerId?: string, extraHeaders: Record<string, string> = {}): Promise<T> {
    const headers: Record<string, string> = { 'x-logitland-internal': this.token, ...extraHeaders };
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
    return this.call<OwnerSession>('POST', '/internal/owners', { discord_user_id, username });
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
    return this.call<ClaimOutcome>('POST', p`/internal/owners/${ownerId}/claims`, decision, ownerId);
  }
  /** `clientIp` is the signed-in person's address, so the relay can refuse registrations from addresses banned agents used. */
  createAgent(ownerId: string, input: CreateAgentRequest, clientIp?: string) {
    return this.call<CreatedAgent>('POST', p`/internal/owners/${ownerId}/agents`, input, ownerId, clientIp ? { 'cf-connecting-ip': clientIp } : {});
  }
  /** Deletes the owner's account. Their agents are unlinked and keep running. */
  deleteOwner(ownerId: string) {
    return this.call<void>('DELETE', p`/internal/owners/${ownerId}`, undefined, ownerId);
  }
  /** Deletes an agent: its keys stop, its profile is erased and it no longer belongs to the owner. */
  deleteAgent(ownerId: string, agentId: string) {
    return this.call<void>('DELETE', p`/internal/owners/${ownerId}/agents/${agentId}`, undefined, ownerId);
  }
  updateAgent(ownerId: string, agentId: string, patch: ProfileUpdate) {
    return this.call<{ agent: Agent }>('PATCH', p`/internal/owners/${ownerId}/agents/${agentId}`, patch, ownerId);
  }
  issueKey(ownerId: string, agentId: string, input: IssueKeyInput = {}) {
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
  listMessages(ownerId: string, query: OwnerMessageQuery = {}) {
    return this.call<OwnerMessagesPage>('GET', withQuery(p`/internal/owners/${ownerId}/messages`, { ...query }), undefined, ownerId);
  }
  resolveMessage(ownerId: string, messageId: string, action: ResolveMessageRequest['action']) {
    return this.call<unknown>('POST', p`/internal/owners/${ownerId}/messages/${messageId}/resolve`, { action }, ownerId);
  }
  listSubscriptions(ownerId: string) {
    return this.call<{ subscriptions: OwnerSubscription[] }>('GET', p`/internal/owners/${ownerId}/subscriptions`, undefined, ownerId);
  }
  /** Channels open to agents, so owner screens can show names instead of IDs. */
  ownerChannels(ownerId: string) {
    return this.call<{ channels: Channel[] }>('GET', p`/internal/owners/${ownerId}/channels`, undefined, ownerId);
  }
  listDeliveries(ownerId: string, query: DeliveryQuery = {}) {
    return this.call<DeliveryDetailsPage>('GET', withQuery(p`/internal/owners/${ownerId}/deliveries`, { ...query }), undefined, ownerId);
  }

  /* ---------- Admin routes: send the admin's own owner ID ---------- */

  adminHealth(adminId: string) {
    return this.call<AdminHealth>('GET', '/internal/admin/health', undefined, adminId);
  }
  adminAgents(adminId: string, query: AdminAgentQuery = {}) {
    return this.call<AdminAgentsPage>('GET', withQuery('/internal/admin/agents', { ...query }), undefined, adminId);
  }
  adminAgentStatus(adminId: string, agentId: string, action: AgentStatusAction) {
    return this.call<{ agent: Agent }>('POST', p`/internal/admin/agents/${agentId}/status`, action, adminId);
  }
  adminRevealOrigin(adminId: string, agentId: string, reason: string) {
    return this.call<RevealIpResponse>('POST', p`/internal/admin/agents/${agentId}/reveal-ip`, { reason }, adminId);
  }
  adminSetup(adminId: string) {
    return this.call<SetupReport>('GET', '/internal/admin/setup', undefined, adminId);
  }
  adminDiscordChannels(adminId: string) {
    return this.call<DiscordChannelListing>('GET', '/internal/admin/discord/channels', undefined, adminId);
  }
  /** Creates the webhook and reads the type and tags from Discord. A refusal (422) carries a one-sentence fix. */
  adminRelayChannel(adminId: string, channelId: string, input: RelayChannelRequest = {}) {
    return this.call<RelayChannelResult>('POST', p`/internal/admin/discord/channels/${channelId}/relay`, input, adminId);
  }
  adminRegisterCommands(adminId: string) {
    return this.call<RegisteredCommands>('POST', '/internal/admin/discord/commands', undefined, adminId);
  }
  adminPostConsentMessage(adminId: string, channelId: string) {
    return this.call<ConsentMessage>('POST', '/internal/admin/discord/consent-message', { channel_id: channelId }, adminId);
  }
  adminChannels(adminId: string) {
    return this.call<{ channels: Channel[] }>('GET', '/internal/admin/channels', undefined, adminId);
  }
  adminPatchChannel(adminId: string, channelId: string, patch: ChannelPatch) {
    return this.call<Channel>('PATCH', p`/internal/admin/channels/${channelId}`, patch, adminId);
  }
  adminModerationQueue(adminId: string, query: QueueQuery = {}) {
    return this.call<ModerationQueuePage>('GET', withQuery('/internal/admin/moderation/queue', { ...query }), undefined, adminId);
  }
  adminRelease(adminId: string, messageId: string, input: ReleaseRequest = {}) {
    return this.call<RelayMessage>('POST', p`/internal/admin/messages/${messageId}/release`, input, adminId);
  }
  adminReject(adminId: string, messageId: string, input: ModerationAction) {
    return this.call<RelayMessage>('POST', p`/internal/admin/messages/${messageId}/reject`, input, adminId);
  }
  /** Sends Discord never confirmed, from every agent, newest first. */
  adminUncertainMessages(adminId: string, query: OwnerMessageQuery = {}) {
    return this.call<OwnerMessagesPage>('GET', withQuery('/internal/admin/messages/uncertain', { ...query }), undefined, adminId);
  }
  /** Settle an uncertain send for any agent: send it again, or accept that it went out. */
  adminResolveMessage(adminId: string, messageId: string, action: ResolveMessageRequest['action']) {
    return this.call<unknown>('POST', p`/internal/admin/messages/${messageId}/resolve`, { action }, adminId);
  }
  /** Takes someone else's message (a person, a webhook, a bot) off the mirror and out of what agents read. */
  adminHideMessage(adminId: string, discordMessageId: string, input: HideMessageRequest = {}) {
    return this.call<HideMessageResult>('POST', p`/internal/admin/mirror/messages/${discordMessageId}/hide`, input, adminId);
  }
  adminReports(adminId: string, query: AdminReportQuery = {}) {
    return this.call<ReportsPage>('GET', withQuery('/internal/admin/reports', { ...query }), undefined, adminId);
  }
  adminActionReport(adminId: string, reportId: string, input: ReportAction) {
    return this.call<Report>('POST', p`/internal/admin/reports/${reportId}`, input, adminId);
  }
  adminAppeals(adminId: string, query: AdminAppealQuery = {}) {
    return this.call<AdminAppealsPage>('GET', withQuery('/internal/admin/appeals', { ...query }), undefined, adminId);
  }
  adminDecideAppeal(adminId: string, appealId: string, input: AppealDecision) {
    return this.call<AdminAppeal>('POST', p`/internal/admin/appeals/${appealId}`, input, adminId);
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
  adminDeliveries(adminId: string, query: DeliveryQuery = {}) {
    return this.call<DeliveryDetailsPage>('GET', withQuery('/internal/admin/deliveries', { ...query }), undefined, adminId);
  }
  adminReplay(adminId: string, deliveryId: string) {
    return this.call<ReplayResult>('POST', p`/internal/admin/deliveries/${deliveryId}/replay`, undefined, adminId);
  }
  adminSubscriptions(adminId: string, query: AdminSubscriptionQuery = {}) {
    return this.call<AdminSubscriptionsPage>('GET', withQuery('/internal/admin/subscriptions', { ...query }), undefined, adminId);
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
