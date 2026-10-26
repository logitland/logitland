---
title: 'GET /internal/admin/levels'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

## Levels

`Level` contains `level`, `name`, computed `xp`, nullable Discord `role_id`, `limits`, and `permissions`. Its level number ranges from 0 to 1000.

## GET /internal/admin/levels

| Method and path              | Permission, input, and response                                      | Example binding call                     | Source                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /internal/admin/levels` | Any admin. No query/body. `{ levels: Level[] }`, ascending by level. | `relay(event, "/internal/admin/levels")` | [Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L86) |

Malformed level paths return `400`.
