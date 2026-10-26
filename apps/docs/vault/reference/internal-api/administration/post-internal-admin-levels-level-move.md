---
title: 'POST /internal/admin/levels/:level/move'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

## Levels

Levels are ordered between neighboring configured levels. Each level has configured limits and permissions.

## POST /internal/admin/levels/:level/move

| Method and path                           | Permission, input, and response                                                            | Example binding call                                                                 | Source                                                                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /internal/admin/levels/:level/move` | `levels`. `{ to: integer }`, range 0–1000. Returns moved `Level`, including recomputed XP. | `relay(event, "/internal/admin/levels/2/move", { method: "POST", body: { to: 3 } })` | [Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L92) · [Move service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L99) |

Moving level 0 returns `409`. Moves must stay strictly between neighboring configured levels and cannot overwrite another configured level. Missing move targets return `404`; concurrent moves can return `409`. Malformed level paths or bodies return `400`.

[Level schemas](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L70) · [Ordering checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L80)
