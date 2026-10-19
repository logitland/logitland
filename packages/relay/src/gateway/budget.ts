import type { Relay, Stmt } from '../context';

// D1 allows 1,000 queries per Worker invocation on the paid plan (https://developers.cloudflare.com/d1/platform/limits/),
// and that page doesn't say how the statements of a batch count, so each one does. Work that can run long (a backlog
// flush, the backfill after a lost session) counts what it spends, stops when another unit as big as the largest so far
// might not fit, and carries on in a later invocation.

/** Well under 1,000: the same invocation also does the small things (health mirror, resume point, gap events). */
export const QUERY_BUDGET = 700;

class Counted implements Stmt {
  constructor(
    readonly raw: Stmt,
    private readonly tick: () => void,
  ) {}
  bind(...values: unknown[]): Stmt {
    return new Counted(this.raw.bind(...values), this.tick);
  }
  first<T = Record<string, unknown>>(): Promise<T | null> {
    this.tick();
    return this.raw.first<T>();
  }
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    this.tick();
    return this.raw.all<T>();
  }
  run(): Promise<{ meta: { changes: number } }> {
    this.tick();
    return this.raw.run();
  }
}

export function metered(relay: Relay, limit = QUERY_BUDGET) {
  let spent = 0;
  let mark = 0;
  let largest = 0;
  const tick = () => void spent++;
  const db: Relay['db'] = {
    prepare: (sql) => new Counted(relay.db.prepare(sql), tick),
    batch: (statements) => {
      spent += statements.length;
      return relay.db.batch(statements.map((s) => (s instanceof Counted ? s.raw : s)));
    },
  };
  return {
    /** The relay to hand to the work being counted. */
    relay: { ...relay, db } as Relay,
    get spent() {
      return spent;
    },
    /** Asked before each unit of work: is there room for one as costly as the costliest so far? The first always fits. */
    room(): boolean {
      largest = Math.max(largest, spent - mark);
      mark = spent;
      return spent + largest <= limit;
    },
  };
}
