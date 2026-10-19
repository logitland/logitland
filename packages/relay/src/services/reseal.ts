import { iso, type Relay } from '../context';

// After RELAY_SECRET_KEY rotates (old keys listed in RELAY_SECRET_KEYS_OLD), this job re-seals stored values under the
// current key, so the old keys can be removed (DEPLOY.md). It walks each column by primary key in pages, a bounded number
// of statements a run, and remembers where it stopped (job_state). A value that can't be opened (sealed with a key that
// isn't listed any more, say) is logged and passed over, so it never holds up the rest. When a column has been walked to
// the end for the current key it isn't scanned again, because nothing is sealed with an older key after that; a walk that
// met unreadable values is repeated once a day, in case the missing key has been added back.

interface SealedColumn {
  table: string;
  column: string;
  /** SQL for the row key, and how to build the associated data from it. */
  key: string;
  /** The row id is an integer (compared as one, bound as text). */
  numeric?: boolean;
  aad: (row: { k: string; id: string }) => string;
}

const COLUMNS: SealedColumn[] = [
  { table: 'channels', column: 'webhook_ciphertext', key: 'id', aad: (r) => `channels.webhook:${r.k}` },
  { table: 'subscriptions', column: 'url_ciphertext', key: 'id', aad: (r) => `subscriptions.url:${r.k}` },
  { table: 'subscriptions', column: 'secret_ciphertext', key: 'id', aad: (r) => `subscriptions.secret:${r.k}` },
  { table: 'subscriptions', column: 'secret_previous_ciphertext', key: 'id', aad: (r) => `subscriptions.secret_previous:${r.k}` },
  { table: 'agent_origins', column: 'ip_sealed', key: 'agent_id', numeric: true, aad: (r) => `agent_origins.ip:${r.k}` },
];

const PAGE = 100;
/** Statements one run may spend, counting each re-seal as one, and the time it may take. */
const MAX_STATEMENTS = 250;
const DEFAULT_BUDGET_MS = 15_000;
const RETRY_UNREADABLE_MS = 24 * 3_600_000;

interface State {
  /** The key the walk is moving values onto. A different current key starts a new walk. */
  keyId: string;
  /** The last row id handled. */
  after: string;
  /** Values this walk couldn't open. */
  unreadable: number;
  finished: boolean;
  /** When a finished walk with unreadable values is worth repeating. */
  retryAt?: string;
}

const stateKey = (c: SealedColumn) => `reseal:${c.table}.${c.column}`;

/** Re-seals values sealed with an older key. Returns how many were re-sealed this run. */
export async function resealJob(relay: Relay, ctx: { deadline?: number } = {}): Promise<number> {
  const deadline = ctx.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  const keyId = relay.secrets.currentId;
  // Compared with substr, not LIKE: a key ID may contain "_", which LIKE reads as a wildcard.
  const current = `v2.${keyId}.`;
  const now = iso(relay.now());
  let statements = 0;
  let done = 0;

  for (const col of COLUMNS) {
    if (statements >= MAX_STATEMENTS || Date.now() >= deadline) break;
    const saved = await relay.db.prepare('SELECT value FROM job_state WHERE key = ?').bind(stateKey(col)).first<{ value: string }>();
    statements++;
    let state = saved ? (JSON.parse(saved.value) as State) : null;
    if (!state || state.keyId !== keyId || (state.finished && state.retryAt !== undefined && state.retryAt <= now)) {
      state = { keyId, after: col.numeric ? '0' : '', unreadable: 0, finished: false };
    }
    if (state.finished) continue;

    // Not aliased as "id", which ORDER BY would then read instead of the column.
    const rowId = col.numeric ? 'CAST(id AS TEXT)' : 'id';
    while (!state.finished) {
      if (statements >= MAX_STATEMENTS || Date.now() >= deadline) break;
      const { results } = await relay.db
        .prepare(
          `SELECT ${rowId} AS rid, ${col.key} AS k, ${col.column} AS v FROM ${col.table}
           WHERE id > ? AND ${col.column} IS NOT NULL AND substr(${col.column}, 1, ?) != ? ORDER BY id LIMIT ?`,
        )
        .bind(state.after, current.length, current, PAGE)
        .all<{ rid: string; k: string; v: string }>();
      statements++;
      const updates = [];
      for (const row of results) {
        try {
          const aad = col.aad({ k: row.k, id: row.rid });
          const plain = await relay.secrets.open(row.v, aad);
          const sealed = await relay.secrets.seal(plain, aad);
          // Compare-and-set: a value rewritten meanwhile (a new webhook, a rotated secret) is left alone.
          updates.push(relay.db.prepare(`UPDATE ${col.table} SET ${col.column} = ? WHERE id = ? AND ${col.column} = ?`).bind(sealed, row.rid, row.v));
        } catch (error) {
          state.unreadable++;
          relay.log.error('reseal.failed', { table: col.table, column: col.column, id: row.rid, error });
        }
      }
      if (updates.length) {
        statements += updates.length;
        for (const r of await relay.db.batch(updates)) done += r.meta.changes;
      }
      if (results.length) state.after = results[results.length - 1]!.rid;
      if (results.length < PAGE) {
        state.finished = true;
        if (state.unreadable) state.retryAt = iso(new Date(relay.now().getTime() + RETRY_UNREADABLE_MS));
        relay.log.info('reseal.walked', { table: col.table, column: col.column, key_id: keyId, unreadable: state.unreadable });
      }
    }
    await relay.db
      .prepare(
        'INSERT INTO job_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .bind(stateKey(col), JSON.stringify(state), now)
      .run();
    statements++;
  }
  return done;
}
