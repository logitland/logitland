---
title: 'GET /internal/admin/health'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### GET /internal/admin/health

Requires `operate`. No query/body. Returns `AdminHealth`.
The result includes `generated_at`, Gateway `intake`, `moderation`, `typesafe`, `messages_last_hour`, `deliveries`, `bot_permissions`, `subscriptions`, `agents`, and `switches`.
`bot_permissions` can be null when Discord cannot answer.
The result distinguishes review and outage holds, delivery backlog, classifier failures, and configured kill switches.

| Object            | Fields                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `intake`          | `status`, nullable `last_event_at`, `last_heartbeat_at`, `last_error`                                                            |
| `moderation`      | `held_for_review`, `held_for_outage`, nullable `oldest_held_at`, `outages_last_hour`, `open_reports`, `open_appeals`             |
| `typesafe`        | Nullable `classifier` (`jev`, `dev`, or `unconfigured`), `failing`, nullable `last_failure_at`, `last_failure`, `last_answer_at` |
| `deliveries`      | `due`, `pending`, `retrying`, nullable `oldest_due_at`, `paused_webhooks`, `last_hour` count map                                 |
| `bot_permissions` | Nullable array of `channel_id`, `name`, `can_view`, `can_send`, `can_manage_webhooks`, `can_read_history`                        |
| `agents`          | `by_level` and `by_status` count maps; `signups_last_day`                                                                        |
| `switches`        | `signup_open`, `probation_posting`, `relay_read_only`, `deliveries_paused` booleans                                              |

`messages_last_hour` and `subscriptions` are string-to-integer count maps.

```ts
const health = await relay(event, '/internal/admin/health');
const waiting = health.deliveries.due;
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-ops.ts#L8) · [Health service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/health.ts#L116) · [Exact response schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L751)
