// Discord's operation catalog and what each operation requires of the caller, vendored from mia-cx/discord-mcp (see the
// README) with the lookups the relay needs, minus Effect: every operation, one by ID, and a ranked search.

import { packedOperations, source, tokenTable } from './vendor/catalog/generated/index';
import { unpackOperation, type HttpMethod, type OperationEntry, type OperationFamily } from './vendor/catalog/types';

export * from './vendor/permissions';
export * from './vendor/catalog/required-permissions';
export * from './vendor/catalog/types';
export { source };

/** Every operation, in the catalog's order (by operation ID). */
export const operations: readonly OperationEntry[] = packedOperations.map(unpackOperation);

const byId = new Map(operations.map((o) => [o.operationId, o]));
const tokensOf = new Map(operations.map((o) => [o.operationId, new Set(o.tokens.map((i) => tokenTable[i]!))]));

/** One operation by its ID, or undefined. */
export const getOperation = (operationId: string): OperationEntry | undefined => byId.get(operationId);

export interface SearchQuery {
  query?: string;
  method?: HttpMethod;
  family?: OperationFamily;
}

/**
 * Scores an operation against a query, as discord-mcp's catalog service does: an exact ID wins outright, otherwise the
 * query's words are matched against the ID, the path and a maintained gloss, so "kick someone" finds delete_guild_member.
 */
function score(op: OperationEntry, raw: string, terms: string[]): number {
  const id = op.operationId.toLowerCase();
  if (raw !== '' && id === raw) return 1000;
  if (terms.length === 0) return 1;
  const tokens = tokensOf.get(op.operationId) ?? new Set<string>();
  const path = op.path.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (id.includes(term)) total += 10;
    if (path.includes(term)) total += 4;
    if (tokens.has(term)) total += 3;
    else if ([...tokens].some((t) => t.startsWith(term) || term.startsWith(t))) total += 1;
  }
  // Shorter IDs matching the same terms are the more direct answer.
  total -= Math.min(id.length / 20, 4);
  return total > 0 && op.curatedTool !== undefined ? total + 2 : total;
}

/** The operations among `candidates` that match, best first; ties break on ID so pages are stable. */
export function searchOperations(q: SearchQuery, candidates: readonly OperationEntry[] = operations): OperationEntry[] {
  const raw = (q.query ?? '').trim().toLowerCase();
  const terms = raw.split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  return candidates
    .filter((op) => (q.method === undefined || op.method === q.method) && (q.family === undefined || op.family === q.family))
    .map((op) => ({ op, score: score(op, raw, terms) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.op.operationId.localeCompare(b.op.operationId))
    .map((hit) => hit.op);
}
