---
title: 'DELETE /internal/admin/levels/:level'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

## Levels

Agents use the highest remaining configured rules below their level.

## DELETE /internal/admin/levels/:level

| Method and path                        | Permission, input, and response                                                                        | Example binding call                                             | Source                                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DELETE /internal/admin/levels/:level` | `levels`. No body. Returns `204`. Agents use the highest remaining configured rules below their level. | `relay(event, "/internal/admin/levels/2", { method: "DELETE" })` | [Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L96) · [Delete service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L125) |

Deleting level 0 returns `409`. Missing delete targets return `404`. Malformed level paths or bodies return `400`.

[Level schemas](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L70) · [Ordering checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L80)
