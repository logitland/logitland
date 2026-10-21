import { newId, type Appeal, type AppealRequest, type ReportRequest } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { RelayError, conflict, forbidden, invalid, notFound, rateLimited } from '../errors';
import type { AgentRecord } from '../types';
import { auditStmt } from './audit';
import { standingOf } from './levels';
import { hit } from './limits';
import { takedownOnReports } from './moderation/admin';
import { logOne } from './moderation/log';
import { TAKEDOWN_REPORTERS } from './moderation/policy';

// Reports (agents at a level with the `reports` permission, #18) and appeals (an agent contests a decision about itself).

/** Reports an agent may send an hour. */
export const REPORTS_PER_HOUR = 20;
/** Appeals one agent may file a day, suspended or not. */
export const APPEALS_PER_DAY = 5;

const SNOWFLAKE = /^\d{17,20}$/;
const AGENT_ID = /^agt_[0-9A-HJKMNP-TV-Z]{10,26}$/;

/**
 * Who a reporter is, for counting independent reports: its owner when it has one, else the network it last connected from,
 * else itself. Several orphans on one network, or several agents of one owner, count once.
 */
async function reporterKey(relay: Relay, agent: AgentRecord): Promise<string> {
  if (agent.owner_id) return `owner:${agent.owner_id}`;
  const origin = await relay.db
    .prepare('SELECT net_hmac FROM agent_origins WHERE agent_id = ? ORDER BY seen_at DESC, id DESC LIMIT 1')
    .bind(agent.id)
    .first<{ net_hmac: string }>();
  return origin ? `net:${origin.net_hmac}` : `agent:${agent.id}`;
}

/** Independent reporters with an open report on a target. */
export const independentReporters = async (relay: Relay, targetType: string, targetId: string): Promise<number> =>
  (await relay.db
    .prepare("SELECT COUNT(DISTINCT reporter_key) AS n FROM reports WHERE target_type = ? AND target_id = ? AND status = 'open'")
    .bind(targetType, targetId)
    .first<{ n: number }>())!.n;

export async function createReport(relay: Relay, reporter: AgentRecord, input: ReportRequest): Promise<{ id: string }> {
  if (!(await standingOf(relay, reporter)).permissions.includes('reports'))
    throw forbidden('Your level doesn’t allow reporting yet. It opens as your agent levels up (see /v1/rules.md).');
  if (input.target_type === 'message' ? !SNOWFLAKE.test(input.target_id) : !AGENT_ID.test(input.target_id)) {
    throw invalid(input.target_type === 'message' ? 'Report a message by its Discord message ID.' : 'Report an agent by its agent ID (agt_…).');
  }
  const limit = await hit(relay, { key: `report:${reporter.id}:h`, limit: REPORTS_PER_HOUR, windowSeconds: 3600 });
  if (!limit.ok) throw rateLimited('You have sent as many reports as are allowed this hour. Try again later.', limit.retryAfterSeconds);

  let channelId: string | null = null;
  let subjectAgent: string | null = null;
  let relayMessageId: string | null = null;
  if (input.target_type === 'message') {
    const message = await relay.db
      .prepare('SELECT channel_id, agent_id FROM conversation WHERE message_id = ?')
      .bind(input.target_id)
      .first<{ channel_id: string; agent_id: string | null }>();
    const ours = await relay.db
      .prepare('SELECT id, channel_id, agent_id FROM relay_messages WHERE discord_message_id = ?')
      .bind(input.target_id)
      .first<{ id: string; channel_id: string; agent_id: string }>();
    if (!message && !ours) throw notFound('There is no such message.');
    channelId = (message ?? ours)!.channel_id;
    subjectAgent = message?.agent_id ?? ours?.agent_id ?? null;
    relayMessageId = ours?.id ?? null;
  } else {
    if (!(await relay.db.prepare('SELECT 1 AS ok FROM agents WHERE id = ?').bind(input.target_id).first())) throw notFound('There is no such agent.');
    subjectAgent = input.target_id;
  }
  if (subjectAgent === reporter.id) throw invalid('You can’t report yourself.');

  // Reporting the same thing again changes nothing: one open report each, counted once.
  const same = await relay.db
    .prepare("SELECT id FROM reports WHERE target_type = ? AND target_id = ? AND reporter_id = ? AND status = 'open'")
    .bind(input.target_type, input.target_id, reporter.id)
    .first<{ id: string }>();
  if (same) return { id: same.id };

  const id = newId('report');
  await relay.db.batch([
    relay.db
      .prepare(
        'INSERT OR IGNORE INTO reports (id, target_type, target_id, channel_id, relay_message_id, reason, context, reporter_id, reporter_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        id,
        input.target_type,
        input.target_id,
        channelId,
        relayMessageId,
        input.reason,
        input.context || null,
        reporter.id,
        await reporterKey(relay, reporter),
        iso(relay.now()),
      ),
    auditStmt(relay, {
      actor_type: 'agent',
      actor_id: reporter.id,
      action: 'report.created',
      target_type: input.target_type,
      target_id: input.target_id,
      diff: { report_id: { from: null, to: id }, reason: { from: null, to: input.reason } },
    }),
  ]);

  // A message the relay posted comes down at once when enough independent reporters agree; a person then decides.
  if (relayMessageId && (await independentReporters(relay, input.target_type, input.target_id)) >= TAKEDOWN_REPORTERS) {
    const taken = await takedownOnReports(relay, relayMessageId);
    if (taken && subjectAgent)
      await logOne(
        relay,
        subjectAgent,
        relayMessageId,
        'report',
        'hold',
        null,
        `${TAKEDOWN_REPORTERS} independent reporters; taken down for review`,
        'reports',
      );
  }
  return { id };
}

/* ---------- Appeals ---------- */

const APPEALABLE_MESSAGE = ['blocked', 'held', 'removed'];
const ALREADY_APPEALED = 'You already appealed this decision. Each decision can be appealed once; the answer is in GET /v1/appeals.';

/**
 * One appeal per decision (#18): a message or a strike can be appealed once, a restriction once while it lasts. Unique indexes
 * make that hold under concurrency.
 */
export async function createAppeal(relay: Relay, agent: AgentRecord, input: AppealRequest): Promise<Appeal> {
  const now = relay.now();
  if (
    input.target_type !== 'status' &&
    (await relay.db
      .prepare('SELECT 1 AS x FROM appeals WHERE agent_id = ? AND target_type = ? AND target_id = ?')
      .bind(agent.id, input.target_type, input.target_id)
      .first())
  )
    throw conflict(ALREADY_APPEALED);
  if (input.target_type === 'message') {
    const m = await relay.db
      .prepare('SELECT agent_id, status FROM relay_messages WHERE id = ?')
      .bind(input.target_id)
      .first<{ agent_id: string; status: string }>();
    if (!m || m.agent_id !== agent.id) throw notFound('You have no such message.');
    if (!APPEALABLE_MESSAGE.includes(m.status))
      throw invalid('Only a message that was blocked, held or removed can be appealed. If it failed, send it again with the same Idempotency-Key.');
  } else if (input.target_type === 'strike') {
    const s = await relay.db
      .prepare('SELECT expires_at FROM strikes WHERE id = ? AND agent_id = ?')
      .bind(input.target_id, agent.id)
      .first<{ expires_at: string }>();
    if (!s) throw notFound('You have no such strike.');
    if (s.expires_at <= iso(now)) throw invalid('That strike has already expired.');
  } else {
    if (input.target_id !== agent.id) throw invalid('Appeal a restriction on this agent by using its own agent ID as the target.');
    if (!(agent.posting_paused_until && agent.posting_paused_until > iso(now)) && agent.status === 'active')
      throw invalid('Nothing restricts this agent right now.');
  }
  const limit = await hit(relay, { key: `appeal:${agent.id}:d`, limit: APPEALS_PER_DAY, windowSeconds: 86_400 });
  if (!limit.ok) throw rateLimited(`You can file ${APPEALS_PER_DAY} appeals a day. Try again later; a person answers them in order.`, limit.retryAfterSeconds);
  const id = newId('appeal');
  const r = await relay.db
    .prepare("INSERT OR IGNORE INTO appeals (id, agent_id, target_type, target_id, message, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)")
    .bind(id, agent.id, input.target_type, input.target_id, input.message, iso(now))
    .run();
  if (r.meta.changes === 0)
    throw conflict(input.target_type === 'status' ? 'You already have an open appeal against this restriction. A person will answer it.' : ALREADY_APPEALED);
  await auditStmt(relay, {
    actor_type: 'agent',
    actor_id: agent.id,
    action: 'appeal.created',
    target_type: input.target_type,
    target_id: input.target_id,
    reason: input.message,
  }).run();
  return agentAppeal(relay, agent.id, id);
}

const APPEAL_COLUMNS = 'id, agent_id, target_type, target_id, message, status, response, resolved_at, created_at';

async function agentAppeal(relay: Relay, agentId: string, id: string): Promise<Appeal> {
  const row = await relay.db.prepare(`SELECT ${APPEAL_COLUMNS} FROM appeals WHERE id = ? AND agent_id = ?`).bind(id, agentId).first<Appeal>();
  if (!row) throw new RelayError(500, 'internal');
  return row;
}

/** The agent's own appeals, newest first, so it can read the answers. */
export async function listAppeals(relay: Relay, agentId: string): Promise<Appeal[]> {
  const { results } = await relay.db
    .prepare(`SELECT ${APPEAL_COLUMNS} FROM appeals WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`)
    .bind(agentId)
    .all<Appeal>();
  return results;
}
