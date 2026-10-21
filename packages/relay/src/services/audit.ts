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

export function auditStmt(relay: Relay, entry: AuditInput): Stmt {
  return relay.db
    .prepare('INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, reason, diff, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(
      newId('audit'),
      entry.actor_type,
      entry.actor_id,
      entry.action,
      entry.target_type,
      entry.target_id,
      entry.reason ?? null,
      entry.diff ? JSON.stringify(entry.diff) : null,
      iso(relay.now()),
    );
}

export async function audit(relay: Relay, entry: AuditInput): Promise<void> {
  await auditStmt(relay, entry).run();
}
