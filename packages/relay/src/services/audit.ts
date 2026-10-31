import { newId } from '@logitland/contracts';
import { iso, type Relay, type Stmt } from '../context';

export interface AuditInput {
  actor_type: 'owner' | 'admin' | 'agent' | 'system' | 'public';
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason?: string | null;
  diff?: Record<string, { from: unknown; to: unknown }> | null;
}

const INSERT_AUDIT = 'INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, reason, diff, created_at)';

const auditValues = (relay: Relay, entry: AuditInput) =>
  [
    newId('audit'),
    entry.actor_type,
    entry.actor_id,
    entry.action,
    entry.target_type,
    entry.target_id,
    entry.reason ?? null,
    entry.diff ? JSON.stringify(entry.diff) : null,
    iso(relay.now()),
  ] as const;

export function auditStmt(relay: Relay, entry: AuditInput): Stmt {
  return relay.db.prepare(`${INSERT_AUDIT} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...auditValues(relay, entry));
}

/**
 * `auditStmt` that writes only while `condition` (SQL) holds, so one batch can audit exactly when its guarded write applies:
 * placed before the write, with the write's own guard, e.g. `EXISTS (SELECT 1 FROM relay_messages WHERE id = ? AND status = ?)`.
 */
export function auditStmtIf(relay: Relay, entry: AuditInput, condition: string, ...args: unknown[]): Stmt {
  return relay.db.prepare(`${INSERT_AUDIT} SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${condition}`).bind(...auditValues(relay, entry), ...args);
}

export async function audit(relay: Relay, entry: AuditInput): Promise<void> {
  await auditStmt(relay, entry).run();
}
