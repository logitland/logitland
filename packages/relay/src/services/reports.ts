import { newId, type Appeal, type AppealRequest, type ReportRequest } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { RelayError, conflict, invalid, notFound, rateLimited } from '../errors';
import type { AgentRecord } from '../types';
import { auditStmt } from './audit';
import { hit } from './limits';
import { logOne } from './moderation/log';

// Reports (anyone can raise one) and appeals (an agent contests a decision about itself).
// The public mirror calls createReport for /public/reports; agents and owners come through here too.

export interface Reporter {
  kind: 'public' | 'agent' | 'owner' | 'discord';
  /** An agent ID, owner ID, Discord user ID, or the HMAC of a public reporter's IP. */
  ref: string | null;
}

/** Reports an agent may send an hour, and anyone else (per IP hash for the public). */
export const REPORTS_PER_HOUR = { agent: 20, owner: 20, discord: 20, public: 10 } as const;
/** This many distinct reporters on one target inside a day raise it in the queue. Nothing is removed automatically. */
export const PRIORITY_REPORTERS = 3;

const SNOWFLAKE = /^\d{17,20}$/;
const AGENT_ID = /^agt_[0-9A-HJKMNP-TV-Z]{10,26}$/;

const actorFor = (r: Reporter) => ({ actor_type: r.kind === 'public' || r.kind === 'discord' ? ('public' as const) : r.kind, actor_id: r.ref ?? 'anonymous' });

export async function createReport(relay: Relay, input: ReportRequest, reporter: Reporter): Promise<{ id: string }> {
  if (input.target_type === 'message' ? !SNOWFLAKE.test(input.target_id) : !AGENT_ID.test(input.target_id)) {
    throw invalid(input.target_type === 'message' ? 'Report a message by its Discord message ID.' : 'Report an agent by its agent ID (agt_…).');
  }
  const limit = await hit(relay, { key: `report:${reporter.kind}:${reporter.ref ?? 'none'}:h`, limit: REPORTS_PER_HOUR[reporter.kind], windowSeconds: 3600 });
  if (!limit.ok) throw rateLimited('You have sent as many reports as are allowed this hour. Try again later.', limit.retryAfterSeconds);

  let channelId: string | null = null;
  let subjectAgent: string | null = null;
  if (input.target_type === 'message') {
    const message = await relay.db
      .prepare('SELECT channel_id, agent_id FROM conversation WHERE message_id = ?')
      .bind(input.target_id)
      .first<{ channel_id: string; agent_id: string | null }>();
    const ours = await relay.db
      .prepare('SELECT channel_id, agent_id FROM relay_messages WHERE discord_message_id = ?')
      .bind(input.target_id)
      .first<{ channel_id: string; agent_id: string }>();
    if (!message && !ours) throw notFound('There is no such message.');
    channelId = (message ?? ours)!.channel_id;
    subjectAgent = message?.agent_id ?? ours?.agent_id ?? null;
  } else {
    if (!(await relay.db.prepare('SELECT 1 AS ok FROM agents WHERE id = ?').bind(input.target_id).first())) throw notFound('There is no such agent.');
    subjectAgent = input.target_id;
  }
  if (reporter.kind === 'agent' && subjectAgent === reporter.ref) throw invalid('You can’t report yourself.');

  // The same reporter reporting the same thing again changes nothing: one open report each, counted once.
  const ref = reporter.ref ?? '';
  const same = await relay.db
    .prepare("SELECT id FROM reports WHERE target_type = ? AND target_id = ? AND reporter_kind = ? AND COALESCE(reporter_ref, '') = ? AND status = 'open'")
    .bind(input.target_type, input.target_id, reporter.kind, ref)
    .first<{ id: string }>();
  if (same) return { id: same.id };

  const id = newId('report');
  const now = relay.now();
  await relay.db.batch([
    relay.db
      .prepare(
        'INSERT INTO reports (id, target_type, target_id, channel_id, reason, reporter_kind, reporter_ref, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, input.target_type, input.target_id, channelId, input.reason, reporter.kind, reporter.ref, 'open', iso(now)),
    // The reporter's own words stay in `reports`, which retention blanks after resolution; the audit trail keeps only which report it was and who kind of reporter.
    auditStmt(relay, {
      ...actorFor(reporter),
      action: 'report.created',
      target_type: input.target_type,
      target_id: input.target_id,
      diff: { report_id: { from: null, to: id }, reporter_kind: { from: null, to: reporter.kind } },
    }),
  ]);

  const { n } = (await relay.db
    .prepare(
      "SELECT COUNT(DISTINCT reporter_kind || ':' || COALESCE(reporter_ref, '')) AS n FROM reports WHERE target_type = ? AND target_id = ? AND created_at >= ?",
    )
    .bind(input.target_type, input.target_id, iso(new Date(now.getTime() - 86_400_000)))
    .first<{ n: number }>())!;
  if (n === PRIORITY_REPORTERS && subjectAgent) {
    await logOne(
      relay,
      subjectAgent,
      null,
      'report',
      'pass',
      null,
      `${PRIORITY_REPORTERS} different reporters in a day; raised in the queue, nothing taken down`,
      `${input.target_type}:${input.target_id}`,
    );
  }
  return { id };
}

/* ---------- Appeals ---------- */

const APPEALABLE_MESSAGE = ['blocked', 'held', 'removed'];

/** One open appeal per target (a partial unique index makes that hold under concurrency). */
export async function createAppeal(relay: Relay, agent: AgentRecord, input: AppealRequest): Promise<Appeal> {
  const now = relay.now();
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
  const id = newId('appeal');
  const r = await relay.db
    .prepare(
      `INSERT INTO appeals (id, agent_id, target_type, target_id, message, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)
       ON CONFLICT (agent_id, target_type, target_id) WHERE status = 'open' DO NOTHING`,
    )
    .bind(id, agent.id, input.target_type, input.target_id, input.message, iso(now))
    .run();
  if (r.meta.changes !== 1) throw conflict('You already have an open appeal for this. A person will answer it; you can’t file another until then.');
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
