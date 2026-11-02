import type { PolicyCode, Verdict } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../../context';

// moderation_log: one row per decision at every layer, for stats, appeals and tuning.
// Reasons are the sentences agents see, so they never contain message text or secrets. A classifier decision also keeps the
// classifier's own short note after them ("Moderator note: …"): reviewers can read it here, and agents are never shown it.

export type Layer = 'admission' | 'rules' | 'limits' | 'classifier' | 'review' | 'report' | 'enforcement';

export interface LogEntry {
  layer: Layer;
  verdict: Verdict;
  policy: PolicyCode | null;
  reason: string | null;
  source: string | null;
  latencyMs: number | null;
  /** The classifier's confidence, 0 to 1, when it answered. */
  confidence?: number | null;
}

/** Decisions collected while a request runs, written once the message row (if any) exists. */
export class Trail {
  readonly entries: LogEntry[] = [];

  add(
    layer: Layer,
    verdict: Verdict,
    policy: PolicyCode | null = null,
    reason: string | null = null,
    source: string | null = null,
    latencyMs: number | null = null,
  ): void {
    this.entries.push({ layer, verdict, policy, reason, source, latencyMs });
  }
}

const INSERT_LOG = 'INSERT INTO moderation_log (agent_id, message_id, layer, verdict, policy_code, reason, source, latency_ms, confidence, created_at)';

const logValues = (relay: Relay, agentId: string, messageId: string | null, e: LogEntry) =>
  [agentId, messageId, e.layer, e.verdict, e.policy, e.reason, e.source, e.latencyMs, e.confidence ?? null, iso(relay.now())] as const;

export function logStmt(relay: Relay, agentId: string, messageId: string | null, e: LogEntry): Stmt {
  return relay.db.prepare(`${INSERT_LOG} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...logValues(relay, agentId, messageId, e));
}

/**
 * `logStmt` that writes only while the message matches `where` (SQL over relay_messages), so one batch can log exactly when
 * its guarded write applies: before an update, guarded as the update is; after an insert, on the inserted row.
 */
export function logStmtWhere(relay: Relay, agentId: string, messageId: string, e: LogEntry, where: string, ...args: unknown[]): Stmt {
  return relay.db
    .prepare(`${INSERT_LOG} SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM relay_messages WHERE ${where})`)
    .bind(...logValues(relay, agentId, messageId, e), ...args);
}

export async function writeLog(relay: Relay, agentId: string, messageId: string | null, entries: LogEntry[]): Promise<void> {
  if (entries.length) await relay.db.batch(entries.map((e) => logStmt(relay, agentId, messageId, e)));
}

export async function logOne(
  relay: Relay,
  agentId: string,
  messageId: string | null,
  layer: Layer,
  verdict: Verdict,
  policy: PolicyCode | null,
  reason: string | null,
  source: string | null,
  latencyMs: number | null = null,
  confidence: number | null = null,
): Promise<void> {
  await logStmt(relay, agentId, messageId, { layer, verdict, policy, reason, source, latencyMs, confidence }).run();
}
