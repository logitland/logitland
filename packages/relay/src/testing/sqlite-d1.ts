// A D1-shaped wrapper around Node's built-in SQLite, for tests and local scripts.
// It covers the subset the relay uses: prepare/bind/first/all/run and transactional batch.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, Stmt } from '../context';

class SqliteStmt implements Stmt {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): Stmt {
    // D1 refuses undefined; so does this, so a missing value fails in tests too.
    return new SqliteStmt(
      this.db,
      this.sql,
      values.map((v, i) => {
        if (v === undefined) throw new TypeError(`D1_TYPE_ERROR: undefined bound at position ${i + 1} in: ${this.sql.slice(0, 80)}`);
        return typeof v === 'boolean' ? Number(v) : (v as SQLInputValue);
      }),
    );
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(r.changes) } };
  }

  runSync() {
    return this.db.prepare(this.sql).run(...this.params);
  }
}

export class SqliteD1 implements Db {
  readonly raw: DatabaseSync;
  constructor(path = ':memory:') {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql: string): Stmt {
    return new SqliteStmt(this.raw, sql);
  }

  /** D1 runs a batch as one transaction; so does this. */
  async batch(statements: Stmt[]): Promise<{ meta: { changes: number } }[]> {
    this.raw.exec('BEGIN');
    try {
      const out = statements.map((s) => ({ meta: { changes: Number((s as SqliteStmt).runSync().changes) } }));
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  migrate(dir: string): this {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) this.raw.exec(readFileSync(join(dir, file), 'utf8'));
    return this;
  }
}
