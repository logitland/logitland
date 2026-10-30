// A D1-shaped wrapper around Node's built-in SQLite, for tests and local scripts.
// It covers the subset the relay uses: prepare/bind/first/all/run and transactional batch, and counts round trips as D1
// would make them, so tests can hold a route to a budget.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, Stmt } from '../context';

class SqliteStmt implements Stmt {
  constructor(
    private readonly owner: SqliteD1,
    readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): Stmt {
    // D1 allows 100 bound parameters a query (developers.cloudflare.com/d1/platform/limits) and has no BigInt type.
    if (values.length > 100) throw new RangeError(`D1_ERROR: too many bound parameters (${values.length}, the limit is 100) in: ${this.sql.slice(0, 80)}`);
    // D1 refuses undefined; so does this, so a missing value fails in tests too.
    return new SqliteStmt(
      this.owner,
      this.sql,
      values.map((v, i) => {
        if (v === undefined) throw new TypeError(`D1_TYPE_ERROR: undefined bound at position ${i + 1} in: ${this.sql.slice(0, 80)}`);
        if (typeof v === 'bigint') throw new TypeError(`D1_TYPE_ERROR: BigInt bound at position ${i + 1} in: ${this.sql.slice(0, 80)}`);
        return typeof v === 'boolean' ? Number(v) : (v as SQLInputValue);
      }),
    );
  }

  async first<T>(): Promise<T | null> {
    this.owner.roundTrips++;
    return (this.owner.raw.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.owner.roundTrips++;
    return { results: this.owner.raw.prepare(this.sql).all(...this.params) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    this.owner.roundTrips++;
    return { meta: { changes: this.runSync() } };
  }

  /** Rows changed, counting what triggers wrote, as D1 does (SQLite's own `changes` leaves those out). */
  runSync(): number {
    return this.execSync().meta.changes;
  }

  /** The statement's rows, read or returned, and the rows it changed. */
  execSync<T>(): { results: T[]; meta: { changes: number } } {
    const before = this.totalChanges();
    const results = this.owner.raw.prepare(this.sql).all(...this.params) as T[];
    return { results, meta: { changes: this.totalChanges() - before } };
  }

  private totalChanges(): number {
    return Number((this.owner.raw.prepare('SELECT total_changes() AS n').get() as { n: number }).n);
  }
}

export class SqliteD1 implements Db {
  readonly raw: DatabaseSync;
  /** Round trips so far, as D1 would make them: one per statement run on its own, one per batch. */
  roundTrips = 0;
  constructor(path = ':memory:') {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql: string): Stmt {
    return new SqliteStmt(this, sql);
  }

  /** D1 runs a batch as one transaction in one round trip; so does this. */
  async batch<T = Record<string, unknown>>(statements: Stmt[]): Promise<{ results: T[]; meta: { changes: number } }[]> {
    this.roundTrips++;
    this.raw.exec('BEGIN');
    try {
      const out = statements.map((s) => (s as SqliteStmt).execSync<T>());
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  migrate(dir: string): this {
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort())
      this.raw.exec(readFileSync(join(dir, file), 'utf8'));
    return this;
  }
}
