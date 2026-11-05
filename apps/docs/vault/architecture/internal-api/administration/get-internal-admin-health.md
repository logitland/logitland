---
title: Read admin health
description: Read operational health and service status.
operation:
  method: GET
  path: /internal/admin/health
  server: https://relay
  parameters:
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs the `operate` admin permission.
  responses:
    '200':
      contentType: application/json
      description: Operational health details.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-ops.ts#L8
  - label: Health service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/health.ts#L116
  - label: Exact response schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L830
---

The result includes `generated_at`, Gateway `intake`, `moderation`, `typesafe`, `messages_last_hour`, `deliveries`, `bot_permissions`, `subscriptions`, `agents`, and `switches`. `bot_permissions` can be null when Discord cannot answer. The result distinguishes review and outage holds, delivery backlog, classifier failures, and configured kill switches.

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
See [shared authentication, errors, and binding examples](../index.md).
