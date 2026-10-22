// The relay's one door to Discord's operation catalog and its required-permissions table. Today they come from
// @logitland/discord-catalog, vendored from mia-cx/discord-mcp; when discord-mcp publishes its own package, only this file
// changes.

export {
  computeEffectivePermissions,
  getOperation,
  hierarchyRules,
  namesToBits,
  operations,
  requiredPermissions,
  searchOperations,
  type ConditionalRequirement,
  type HierarchyRequirement,
  type OperationEntry,
  type OperationPermissions,
  type PermissionGrant,
  type PermissionName,
  type RoleLike,
} from '@logitland/discord-catalog';
