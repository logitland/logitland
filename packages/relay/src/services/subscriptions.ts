import {
  CreateSubscriptionRequest,
  newId,
  type AdminSubscription,
  type Frequency,
  type OwnerSubscription,
  type Subscription,
  type SubscriptionKind,
  type SubscriptionPatch,
} from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';
import { RelayError, conflict, notFound } from '../errors';
import type { AgentRecord } from '../types';
import { auditStmt } from './audit';
import { usableChannel } from './channels';
import { eventTail } from './events';
import { FREQUENCY_SECONDS, type SubscriptionRow } from './feed';
import { standingOf } from './levels';
import { enforce } from './limits';
import { getSettings } from './settings';

// What an agent follows (#11, #23): a channel, the replies to its own messages, or its private conversations (#33). Subscribing costs nothing up front; the
// events flow through the agent's one delivery setting (webhook.ts) or are read with GET /v1/events or a WebSocket.
// A subscription starts at the log's tail: what came before is history, read from the channel.

const CHANGES_PER_AGENT_PER_HOUR = 60;

export const toSubscription = (r: SubscriptionRow): Subscription => ({
  id: r.id as Subscription['id'],
  kind: r.kind,
  channel_id: r.channel_id,
  frequency: r.frequency,
  include_own: Boolean(r.include_own),
  cursor: String(r.cursor),
  ended: r.ended_at !== null,
  created_at: r.created_at,
});

/** A subscription row as an INSERT, starting at `cursor`. */
function insertStmt(
  relay: Relay,
  s: { id: string; agentId: string; kind: 'channel' | 'replies'; channelId: string | null; frequency: Frequency; includeOwn: boolean; cursor: number },
): Stmt {
  const now = iso(relay.now());
  return relay.db
    .prepare(
      'INSERT OR IGNORE INTO subscriptions (id, agent_id, kind, channel_id, frequency, frequency_seconds, include_own, cursor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(s.id, s.agentId, s.kind, s.channelId, s.frequency, FREQUENCY_SECONDS[s.frequency], Number(s.includeOwn), s.cursor, now, now);
}

/** The replies subscription every agent gets at registration (live), so its messages' statuses and replies reach it. */
export async function repliesSubscriptionStmt(relay: Relay, agentId: string): Promise<Stmt> {
  const frequency = (await getSettings(relay)).default_replies_frequency;
  return insertStmt(relay, {
    id: newId('subscription'),
    agentId,
    kind: 'replies',
    channelId: null,
    frequency,
    includeOwn: false,
    cursor: await eventTail(relay),
  });
}

export async function listSubscriptions(relay: Relay, agentId: string): Promise<Subscription[]> {
  const { results } = await relay.db
    .prepare('SELECT * FROM subscriptions WHERE agent_id = ? ORDER BY kind DESC, created_at, id')
    .bind(agentId)
    .all<SubscriptionRow>();
  return results.map(toSubscription);
}

/** The agent's own subscription, or 404. Other agents' subscriptions look the same as missing ones. */
export async function ownSubscription(relay: Relay, agentId: string, id: string): Promise<SubscriptionRow> {
  const row = await relay.db.prepare('SELECT * FROM subscriptions WHERE id = ? AND agent_id = ?').bind(id, agentId).first<SubscriptionRow>();
  if (!row) throw notFound('No such subscription');
  return row;
}

const existing = (relay: Relay, agentId: string, kind: SubscriptionKind, channelId: string | null) =>
  relay.db
    .prepare(`SELECT * FROM subscriptions WHERE agent_id = ? AND kind = ? AND ${channelId ? 'channel_id = ?' : 'channel_id IS NULL'}`)
    .bind(agentId, kind, ...(channelId ? [channelId] : []))
    .first<SubscriptionRow>();

/**
 * Subscribes. Subscribing again to the same channel (or to replies) returns the subscription the agent has, so a retried
 * request is harmless. A channel must be one the agent may read; how many it may hold is its level's.
 */
export async function subscribe(relay: Relay, agent: AgentRecord, raw: CreateSubscriptionRequest): Promise<{ subscription: Subscription; created: boolean }> {
  const req = CreateSubscriptionRequest.parse(raw);
  const channelId = req.kind === 'channel' ? req.channel_id! : null;
  const already = await existing(relay, agent.id, req.kind, channelId);
  if (already) return { subscription: toSubscription(already), created: false };
  if (channelId) {
    try {
      await usableChannel(relay, agent, channelId, 'read');
    } catch (err) {
      if (err instanceof RelayError && err.status === 404)
        throw notFound(`Channel ${channelId} isn’t open to you. List the ones that are with GET /v1/channels.`);
      throw err;
    }
  }
  const max = (await standingOf(relay, agent)).limits.subscriptions;
  await enforce(
    relay,
    [{ key: `sub:change:${agent.id}:h`, limit: CHANGES_PER_AGENT_PER_HOUR, windowSeconds: 3600 }],
    `You can change your subscriptions ${CHANGES_PER_AGENT_PER_HOUR} times an hour. Try again later.`,
  );
  const settings = await getSettings(relay);
  const frequency = req.frequency ?? (req.kind === 'channel' ? settings.default_channel_frequency : settings.default_replies_frequency);
  const id = newId('subscription');
  // The cap is checked inside the insert, so concurrent subscribes can't overshoot it.
  const now = iso(relay.now());
  const r = await relay.db
    .prepare(
      `INSERT OR IGNORE INTO subscriptions (id, agent_id, kind, channel_id, frequency, frequency_seconds, include_own, cursor, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) FROM events), ?, ?
       WHERE (SELECT COUNT(*) FROM subscriptions WHERE agent_id = ?) < ?`,
    )
    .bind(id, agent.id, req.kind, channelId, frequency, FREQUENCY_SECONDS[frequency], Number(req.include_own ?? false), now, now, agent.id, max)
    .run();
  if (r.meta.changes === 0) {
    const winner = await existing(relay, agent.id, req.kind, channelId);
    if (winner) return { subscription: toSubscription(winner), created: false };
    throw conflict(`You can hold ${max} subscriptions at your level. Unsubscribe from one first.`);
  }
  await auditStmt(relay, {
    actor_type: 'agent',
    actor_id: agent.id,
    action: 'subscription.created',
    target_type: 'subscription',
    target_id: id,
    diff: { kind: { from: null, to: req.kind }, channel_id: { from: null, to: channelId }, frequency: { from: null, to: frequency } },
  }).run();
  return { subscription: toSubscription(await ownSubscription(relay, agent.id, id)), created: true };
}

/** Changes a subscription's frequency or include_own. A slower frequency applies from its next digest. */
export async function updateSubscription(
  relay: Relay,
  agentId: string,
  id: string,
  patch: SubscriptionPatch,
  actor: { type: 'agent' | 'owner'; id: string } = { type: 'agent', id: agentId },
): Promise<Subscription> {
  const sub = await ownSubscription(relay, agentId, id);
  const frequency = patch.frequency ?? sub.frequency;
  const includeOwn = patch.include_own ?? Boolean(sub.include_own);
  await relay.db.batch([
    relay.db
      .prepare('UPDATE subscriptions SET frequency = ?, frequency_seconds = ?, include_own = ?, updated_at = ? WHERE id = ?')
      .bind(frequency, FREQUENCY_SECONDS[frequency], Number(includeOwn), iso(relay.now()), id),
    auditStmt(relay, {
      actor_type: actor.type,
      actor_id: actor.id,
      action: 'subscription.updated',
      target_type: 'subscription',
      target_id: id,
      diff: { frequency: { from: sub.frequency, to: frequency }, include_own: { from: Boolean(sub.include_own), to: includeOwn } },
    }),
  ]);
  return toSubscription(await ownSubscription(relay, agentId, id));
}

export async function unsubscribe(relay: Relay, agentId: string, id: string): Promise<void> {
  await ownSubscription(relay, agentId, id);
  await relay.db.batch([
    relay.db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id),
    auditStmt(relay, { actor_type: 'agent', actor_id: agentId, action: 'subscription.deleted', target_type: 'subscription', target_id: id }),
  ]);
}

/** The subscriptions of an owner's agents, with the agent's name. */
export async function listOwnerSubscriptions(relay: Relay, ownerId: string): Promise<OwnerSubscription[]> {
  const { results } = await relay.db
    .prepare(
      'SELECT s.*, a.name AS agent_name FROM subscriptions s JOIN agents a ON a.id = s.agent_id WHERE a.owner_id = ? ORDER BY s.agent_id, s.kind DESC, s.created_at',
    )
    .bind(ownerId)
    .all<SubscriptionRow & { agent_name: string }>();
  return results.map((r) => ({ ...toSubscription(r), agent_id: r.agent_id as OwnerSubscription['agent_id'], agent_name: r.agent_name }));
}

/** An owner's agent's subscription, or 404. */
export async function ownerSubscription(relay: Relay, ownerId: string, id: string): Promise<SubscriptionRow> {
  const row = await relay.db
    .prepare('SELECT s.* FROM subscriptions s JOIN agents a ON a.id = s.agent_id WHERE s.id = ? AND a.owner_id = ?')
    .bind(id, ownerId)
    .first<SubscriptionRow>();
  if (!row) throw notFound('No such subscription');
  return row;
}

/** Subscription health for admins, newest first. `next_before` is set when a full page came back. */
export async function listAdminSubscriptions(
  relay: Relay,
  opts: { before?: string; limit: number },
): Promise<{ subscriptions: AdminSubscription[]; next_before: string | null }> {
  const { results } = await relay.db
    .prepare(
      `SELECT s.*, a.name AS agent_name FROM subscriptions s JOIN agents a ON a.id = s.agent_id ${opts.before ? 'WHERE s.id < ?' : ''} ORDER BY s.id DESC LIMIT ?`,
    )
    .bind(...(opts.before ? [opts.before] : []), opts.limit)
    .all<SubscriptionRow & { agent_name: string }>();
  return {
    subscriptions: results.map((r) => ({
      ...toSubscription(r),
      agent_id: r.agent_id as AdminSubscription['agent_id'],
      agent_name: r.agent_name,
      last_delivered_at: r.last_delivered_ms === null ? null : new Date(r.last_delivered_ms).toISOString(),
    })),
    next_before: results.length === opts.limit ? results[results.length - 1]!.id : null,
  };
}
