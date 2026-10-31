---
title: Inspect gateway state
description: Return gateway sessions and recent recorded frames.
operation:
  method: GET
  path: /_fake/gateway
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: limit
      in: query
      type: number
      default: 200
      description: Number of most recent frames to return; not validated or range-checked.
      example: 20
  responses:
    '200':
      contentType: application/json
      description: Returns `{sessions,frames}`.
    '400':
      description: Malformed JSON request body.
source:
  - label: inspection
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L336-L343
  - label: session and frame fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L130
  - label: session summaries
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L187
  - label: frame recording
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L315
---

`limit` affects frames only, not sessions. The handler applies `Number(limit)` and JavaScript's `slice(-limit)` without validation: `0` or nonnumeric input returns all retained frames, and a negative value skips that many oldest frames.

## Session summaries

Each summary contains `id`, `user_id`, `intents`, `connected`, `seq`, `buffered`, `heartbeats`, `last_heartbeat_at`, `resumes`, and `expired`. `last_heartbeat_at` is an ISO timestamp or `null` before the first heartbeat. Expired sessions remain listed; `expired` does not automatically reflect an elapsed resume window.

## Recorded frames

Each frame contains `at`, `connection`, `session`, `direction`, `op`, `t`, `s`, and `d`. `at` is an ISO timestamp; `direction` is `in` or `out`. `session` is `null` before authentication, and absent event names or sequences become `null`.

The log retains at most 5,000 records, in recording order. [Raw-text control sends](post-gateway-raw.md) bypass this log. Frame data includes bot tokens sent in IDENTIFY and RESUME, so treat inspection output as sensitive.
