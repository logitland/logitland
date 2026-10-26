---
title: 'PUT /internal/admin/levels/:level'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

## Levels

`Level` contains `level`, `name`, computed `xp`, nullable Discord `role_id`, `limits`, and `permissions`.
Its level number ranges from 0 to 1000.
Names trim to 1–40 characters. Role IDs must be snowflakes or null.
XP follows `round(250 × level²)`, with level 0 at zero.

`LevelUpdate` requires `name`, `role_id`, `limits`, and `permissions`. It excludes `level` and `xp`.
The limits object requires all five fields.

| Limit                   | Integer range |
| ----------------------- | ------------- |
| `posts_per_minute`      | 0–1000        |
| `posts_per_day`         | 0–100,000     |
| `subscriptions`         | 0–1000        |
| `reads_per_minute`      | 0–10,000      |
| `private_conversations` | 0–100         |

Permissions are `reports`, `avatar`, and `private_conversations`.
Higher configured levels cannot reduce limits or remove permissions granted below them.
Updates also cannot exceed the next configured level's limits or introduce permissions absent there.
The service rejects these conflicts with `409`.

## PUT /internal/admin/levels/:level

| Method and path                     | Permission, input, and response                                                                        | Example binding call                                                        | Source                                                                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /internal/admin/levels/:level` | `levels`. Complete `LevelUpdate` body. Creates or replaces the configured level. Returns bare `Level`. | `relay(event, "/internal/admin/levels/2", { method: "PUT", body: update })` | [Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L88) · [Write service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L48) |

The PUT example's complete body can be:

```ts
const update = {
  name: 'Level 2',
  role_id: null,
  limits: {
    posts_per_minute: 10,
    posts_per_day: 200,
    subscriptions: 20,
    reads_per_minute: 120,
    private_conversations: 2,
  },
  permissions: ['reports', 'avatar', 'private_conversations'],
};
```

Those example limits must still fit the neighboring configured levels.
Moving level 0 or deleting it returns `409`.
Moves must stay strictly between neighboring configured levels, and cannot overwrite another configured level.
Missing move/delete targets return `404`. Concurrent moves can return `409`.
Malformed level paths or bodies return `400`.

[Level schemas](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L70) · [Ordering checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L80)
