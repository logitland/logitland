// The relay's one door to Discord's operation catalog and its required-permissions table, from @mia-cx/discord-catalog
// (mia-cx/discord-mcp). The package serves lookups through an Effect service; this file runs it once and exposes plain
// functions, so nothing else in the relay touches Effect.

import { OperationCatalog, type HttpMethod, type OperationEntry, type OperationFamily } from '@mia-cx/discord-catalog';
import { Effect } from 'effect';

export {
  computeEffectivePermissions,
  hierarchyRules,
  namesToBits,
  requiredPermissions,
  type ConditionalRequirement,
  type HierarchyRequirement,
  type OperationEntry,
  type OperationPermissions,
  type PermissionGrant,
  type PermissionName,
  type RoleLike,
} from '@mia-cx/discord-catalog';

const catalog = Effect.runSync(OperationCatalog.useSync((c) => c).pipe(Effect.provide(OperationCatalog.layer)));

/** Every operation, in the catalog's order (by operation ID). */
export const operations: readonly OperationEntry[] = catalog.all;

const byId = new Map(operations.map((o) => [o.operationId, o]));

/** One operation by its ID, or undefined. */
export const getOperation = (operationId: string): OperationEntry | undefined => byId.get(operationId);

/**
 * The operations among `candidates` that match, best first: an exact ID wins outright, otherwise plain words match the ID,
 * the path and a maintained gloss, so "kick someone" finds delete_guild_member.
 */
export function searchOperations(
  q: { query?: string; method?: HttpMethod; family?: OperationFamily },
  candidates: readonly OperationEntry[] = operations,
): OperationEntry[] {
  const allowed = new Set(candidates);
  return catalog.search({ ...q, limit: operations.length }).hits.flatMap((hit) => (allowed.has(hit.operation) ? [hit.operation] : []));
}
