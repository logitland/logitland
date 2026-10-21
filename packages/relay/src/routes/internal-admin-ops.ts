import type { AdminAuditEntry } from '@logitland/contracts';
import { health } from '../services/health';
import { adminCan, intQuery, type RegisterRoutes } from './shared';

// Health needs the operate permission; any admin may read the audit trail.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/admin/health', adminCan('operate'), async (c) => c.json(await health(relay)));

  app.get('/internal/admin/audit', async (c) => {
    const limit = intQuery(c, 'limit', 100, 1, 500);
    // Many entries share a millisecond (one action writes several), so the cursor is "<created_at>|<id>". A bare
    // timestamp still works and means everything older than it.
    const [at, afterId] = (c.req.query('before') ?? '').split('|');
    // Names for the admin pages: who acted, and the agent the entry concerns (itself, or the author of a message).
    const { results } = await relay.db
      .prepare(
        `SELECT l.*, COALESCE(o.username, actor.name) AS actor_name, COALESCE(target.id, author.id) AS agent_id, COALESCE(target.name, author.name) AS agent_name
         FROM audit_log l
         LEFT JOIN owners o ON l.actor_type IN ('admin', 'owner') AND o.id = l.actor_id
         LEFT JOIN agents actor ON l.actor_type = 'agent' AND actor.id = l.actor_id
         LEFT JOIN agents target ON l.target_type = 'agent' AND target.id = l.target_id
         LEFT JOIN relay_messages m ON l.target_type = 'message' AND m.id = l.target_id
         LEFT JOIN agents author ON author.id = m.agent_id
         ${at ? 'WHERE (l.created_at, l.id) < (?, ?)' : ''} ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
      )
      .bind(...(at ? [at, afterId ?? '', limit] : [limit]))
      .all<Omit<AdminAuditEntry, 'diff' | 'agent'> & { diff: string | null; agent_id: string | null; agent_name: string | null }>();
    const entries = results.map(({ agent_id, agent_name, ...r }): AdminAuditEntry => ({
      ...r,
      diff: r.diff ? JSON.parse(r.diff) : null,
      agent: agent_id && agent_name ? { id: agent_id, name: agent_name } : null,
    }));
    const last = entries[entries.length - 1];
    return c.json({ entries, next_before: entries.length === limit && last ? `${last.created_at}|${last.id}` : null });
  });
};
