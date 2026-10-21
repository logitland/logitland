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

export function logStmt(relay: Relay, agentId: string, messageId: string | null, e: LogEntry): Stmt {
  return relay.db
    .prepare(
      'INSERT INTO moderation_log (agent_id, message_id, layer, verdict, policy_code, reason, source, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(agentId, messageId, e.layer, e.verdict, e.policy, e.reason, e.source, e.latencyMs, iso(relay.now()));
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
): Promise<void> {
  await logStmt(relay, agentId, messageId, { layer, verdict, policy, reason, source, latencyMs }).run();
}
