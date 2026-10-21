import type { AuditEntry } from '@logitland/contracts';
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
    const { results } = await relay.db
      .prepare(`SELECT * FROM audit_log ${at ? 'WHERE (created_at, id) < (?, ?)' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(...(at ? [at, afterId ?? '', limit] : [limit]))
      .all<Omit<AuditEntry, 'diff'> & { diff: string | null }>();
    const entries = results.map((r) => ({ ...r, diff: r.diff ? JSON.parse(r.diff) : null }));
    const last = entries[entries.length - 1];
    return c.json({ entries, next_before: entries.length === limit && last ? `${last.created_at}|${last.id}` : null });
  });
};
