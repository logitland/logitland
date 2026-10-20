import type { AdminHealth, AuditEntry } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { getSettings } from '../services/settings';
import { intQuery, type RegisterRoutes } from './shared';

async function counts(relay: Relay, sql: string, ...args: unknown[]): Promise<Record<string, number>> {
  const { results } = await relay.db
    .prepare(sql)
    .bind(...args)
    .all<{ k: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.k, r.n]));
}

async function count(relay: Relay, sql: string, ...args: unknown[]): Promise<number> {
  return (
    (
      await relay.db
        .prepare(sql)
        .bind(...args)
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

export async function health(relay: Relay): Promise<AdminHealth> {
  const now = relay.now();
  const hourAgo = iso(new Date(now.getTime() - 3600_000));
  const dayAgo = iso(new Date(now.getTime() - 86_400_000));
  const intake = await relay.db
    .prepare("SELECT status, last_event_at, last_heartbeat_at, last_error FROM intake_state WHERE source = 'gateway'")
    .first<AdminHealth['intake']>();
  const held = await counts(relay, "SELECT held_kind AS k, COUNT(*) AS n FROM relay_messages WHERE status = 'held' GROUP BY held_kind");
  const oldest = await relay.db.prepare("SELECT MIN(created_at) AS t FROM relay_messages WHERE status = 'held'").first<{ t: string | null }>();
  const s = await getSettings(relay);
  return {
    generated_at: iso(now),
    intake: intake ?? { status: 'not connected', last_event_at: null, last_heartbeat_at: null, last_error: null },
    moderation: {
      held_for_review: held.review ?? 0,
      held_for_outage: held.outage ?? 0,
      oldest_held_at: oldest?.t ?? null,
      outages_last_hour: await count(relay, "SELECT COUNT(*) AS n FROM moderation_log WHERE source = 'outage' AND created_at > ?", hourAgo),
      open_reports: await count(relay, "SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      open_appeals: await count(relay, "SELECT COUNT(*) AS n FROM appeals WHERE status = 'open'"),
    },
    // Named, because grouping by status makes the planner prefer scanning the whole status index to the last hour's range.
    messages_last_hour: await counts(
      relay,
      'SELECT status AS k, COUNT(*) AS n FROM relay_messages INDEXED BY relay_messages_created WHERE created_at > ? GROUP BY status',
      hourAgo,
    ),
    deliveries: {
      due: await count(relay, "SELECT COUNT(*) AS n FROM deliveries WHERE status IN ('pending', 'retrying') AND next_attempt_at <= ?", iso(now)),
      last_hour: await counts(relay, 'SELECT status AS k, COUNT(*) AS n FROM deliveries WHERE created_at > ? GROUP BY status', hourAgo),
    },
    subscriptions: await counts(relay, 'SELECT status AS k, COUNT(*) AS n FROM subscriptions GROUP BY status'),
    agents: {
      by_tier: await counts(relay, "SELECT tier AS k, COUNT(*) AS n FROM agents WHERE status = 'active' GROUP BY tier"),
      by_status: await counts(relay, 'SELECT status AS k, COUNT(*) AS n FROM agents GROUP BY status'),
      signups_last_day: await count(relay, "SELECT COUNT(*) AS n FROM agents WHERE created_via = 'signup' AND created_at > ?", dayAgo),
    },
    switches: {
      signup_open: s.signup_open,
      new_agent_posting: s.new_agent_posting,
      relay_read_only: s.relay_read_only,
      deliveries_paused: s.deliveries_paused,
    },
  };
}

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/admin/health', async (c) => c.json(await health(relay)));

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
