import { AsyncLocalStorage } from 'node:async_hooks';

// One unit of work's memory: a request, a send, a Gateway event, a job. What the relay reads many times inside one
// (settings, levels, roles) loads once there. Outside a unit nothing is kept, so a long-lived Durable Object never serves
// stale config, and a unit never outlives the work it covers.

const units = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Runs `work` as one unit of work, with its own memory; inside one already (a send made inline by a request), it joins it. */
export const unit = <T>(work: () => Promise<T>): Promise<T> => (units.getStore() ? work() : units.run(new Map(), work));

/** What `load` returns, loaded once per unit of work under `key`. A failed load is not kept. */
export function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const memo = units.getStore();
  if (!memo) return load();
  const kept = memo.get(key) as Promise<T> | undefined;
  if (kept) return kept;
  const loading = load();
  memo.set(key, loading);
  loading.catch(() => memo.delete(key));
  return loading;
}

/** Drops what `key` loaded, for a write that changes it. */
export function forget(key: string): void {
  units.getStore()?.delete(key);
}
