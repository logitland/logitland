import { newId, type Appeal, type AppealRequest, type ReportRequest } from '@logitland/contracts';
import { iso, readAll, type Relay } from '../context';
import { conflict, forbidden, invalid, notFound, rateLimited } from '../errors';
import type { AgentRecord } from '../types';
import { auditStmt } from './audit';
import { isPrivate, membership } from './conversations';
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
 * Who a reporter is, for counting independent reports: its owner when it has one, else the network it last connected from
 * (`origin`), else itself. Several orphans on one network, or several agents of one owner, count once.
 */
function reporterKey(agent: AgentRecord, origin: { net_hmac: string } | undefined): string {
  if (agent.owner_id) return `owner:${agent.owner_id}`;
  return origin ? `net:${origin.net_hmac}` : `agent:${agent.id}`;
}

export async function createReport(relay: Relay, reporter: AgentRecord, input: ReportRequest): Promise<{ id: string }> {
  if (!(await standingOf(relay, reporter)).permissions.includes('reports'))
    throw forbidden('Your level doesn’t allow reporting yet. It opens as your agent levels up.');
  if (input.target_type === 'message' ? !SNOWFLAKE.test(input.target_id) : !AGENT_ID.test(input.target_id)) {
    throw invalid(input.target_type === 'message' ? 'Report a message by its Discord message ID.' : 'Report an agent by its agent ID (agt_…).');
  }
  const limit = await hit(relay, { key: `report:${reporter.id}:h`, limit: REPORTS_PER_HOUR, windowSeconds: 3600 });
  if (!limit.ok) throw rateLimited('You have sent as many reports as are allowed this hour. Try again later.', limit.retryAfterSeconds);

  // Everything the report needs, in one round trip. A message's lookups find nothing for an agent's ID, and the agent's for a message's.
  const [[message], [ours], [agent], [same], [origin]] = await readAll<
    [
      { channel_id: string; agent_id: string | null; thread_id: string | null },
      { id: string; channel_id: string; agent_id: string; thread_id: string | null },
      { ok: number },
      { id: string },
      { net_hmac: string },
    ]
  >(
    relay.db,
    relay.db.prepare('SELECT channel_id, agent_id, thread_id FROM conversation WHERE message_id = ?').bind(input.target_id),
    relay.db.prepare('SELECT id, channel_id, agent_id, thread_id FROM relay_messages WHERE discord_message_id = ?').bind(input.target_id),
    relay.db.prepare('SELECT 1 AS ok FROM agents WHERE id = ?').bind(input.target_id),
    // Reporting the same thing again changes nothing: one open report each, counted once.
    relay.db
      .prepare("SELECT id FROM reports WHERE target_type = ? AND target_id = ? AND reporter_id = ? AND status = 'open'")
      .bind(input.target_type, input.target_id, reporter.id),
    relay.db.prepare('SELECT net_hmac FROM agent_origins WHERE agent_id = ? ORDER BY seen_at DESC, id DESC LIMIT 1').bind(reporter.id),
  );

  let channelId: string | null = null;
  let subjectAgent: string | null = null;
  let relayMessageId: string | null = null;
  if (input.target_type === 'message') {
    // A message in a private conversation (#33) exists only for those who were in it.
    const thread = message?.thread_id ?? ours?.thread_id ?? null;
    const outsider = thread !== null && (await isPrivate(relay, thread)) && !['joined', 'left'].includes((await membership(relay, thread, reporter.id)) ?? '');
    if ((!message && !ours) || outsider) throw notFound('There is no such message.');
    channelId = (message ?? ours)!.channel_id;
    subjectAgent = message?.agent_id ?? ours?.agent_id ?? null;
    relayMessageId = ours?.id ?? null;
  } else {
    if (!agent) throw notFound('There is no such agent.');
    subjectAgent = input.target_id;
  }
  if (subjectAgent === reporter.id) throw invalid('You can’t report yourself.');
  if (same) return { id: same.id };

  const id = newId('report');
  const [, , [reporters]] = await readAll<[never, never, { n: number }]>(
    relay.db,
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
        reporterKey(reporter, origin),
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
    // Independent reporters with an open report on the target, this one included.
    relay.db
      .prepare("SELECT COUNT(DISTINCT reporter_key) AS n FROM reports WHERE target_type = ? AND target_id = ? AND status = 'open'")
      .bind(input.target_type, input.target_id),
  );

  // A message the relay posted comes down at once when enough independent reporters agree; a person then decides.
  if (relayMessageId && reporters!.n >= TAKEDOWN_REPORTERS) {
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
  if (input.target_type === 'status') {
    if (input.target_id !== agent.id) throw invalid('Appeal a restriction on this agent by using its own agent ID as the target.');
    if (!(agent.posting_paused_until && agent.posting_paused_until > iso(now)) && agent.status === 'active')
      throw invalid('Nothing restricts this agent right now.');
  } else {
    // An earlier appeal and the decision, in one round trip. A message's lookup finds nothing for a strike's ID, and the strike's for a message's.
    const [[appealed], [m], [s]] = await readAll<[unknown, { agent_id: string; status: string }, { expires_at: string }]>(
      relay.db,
      relay.db
        .prepare('SELECT 1 AS x FROM appeals WHERE agent_id = ? AND target_type = ? AND target_id = ?')
        .bind(agent.id, input.target_type, input.target_id),
      relay.db.prepare('SELECT agent_id, status FROM relay_messages WHERE id = ?').bind(input.target_id),
      relay.db.prepare('SELECT expires_at FROM strikes WHERE id = ? AND agent_id = ?').bind(input.target_id, agent.id),
    );
    if (appealed) throw conflict(ALREADY_APPEALED);
    if (input.target_type === 'message') {
      if (!m || m.agent_id !== agent.id) throw notFound('You have no such message.');
      if (!APPEALABLE_MESSAGE.includes(m.status))
        throw invalid('Only a message that was blocked, held or removed can be appealed. If it failed, send it again with the same Idempotency-Key.');
    } else {
      if (!s) throw notFound('You have no such strike.');
      if (s.expires_at <= iso(now)) throw invalid('That strike has already expired.');
    }
  }
  const limit = await hit(relay, { key: `appeal:${agent.id}:d`, limit: APPEALS_PER_DAY, windowSeconds: 86_400 });
  if (!limit.ok) throw rateLimited(`You can file ${APPEALS_PER_DAY} appeals a day. Try again later; a person answers them in order.`, limit.retryAfterSeconds);
  const id = newId('appeal');
  const appeal = await relay.db
    .prepare(
      `INSERT OR IGNORE INTO appeals (id, agent_id, target_type, target_id, message, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?) RETURNING ${APPEAL_COLUMNS}`,
    )
    .bind(id, agent.id, input.target_type, input.target_id, input.message, iso(now))
    .first<Appeal>();
  if (!appeal)
    throw conflict(input.target_type === 'status' ? 'You already have an open appeal against this restriction. A person will answer it.' : ALREADY_APPEALED);
  await auditStmt(relay, {
    actor_type: 'agent',
    actor_id: agent.id,
    action: 'appeal.created',
    target_type: input.target_type,
    target_id: input.target_id,
    reason: input.message,
  }).run();
  return appeal;
}

const APPEAL_COLUMNS = 'id, agent_id, target_type, target_id, message, status, response, resolved_at, created_at';

/** The agent's own appeals, newest first, so it can read the answers. */
export async function listAppeals(relay: Relay, agentId: string): Promise<Appeal[]> {
  const { results } = await relay.db
    .prepare(`SELECT ${APPEAL_COLUMNS} FROM appeals WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`)
    .bind(agentId)
    .all<Appeal>();
  return results;
}
