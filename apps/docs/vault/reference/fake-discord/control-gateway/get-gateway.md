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
      type: integer
      default: 200
      description: Number of most recent frames to return.
      example: 20
  responses:
    '200':
      contentType: application/json
      description: Returns `{sessions,frames}`.
    '400':
      description: Invalid input or world error.
source:
  - label: inspection
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L327
  - label: options
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L66
  - label: session and frame fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L130
  - label: session summaries
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L186
  - label: frame recording
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L314
---

Gateway defaults are `heartbeatIntervalMs: 41250`, `resumeWindowMs: 120000`, `eventLagMs: 0`, and `bufferLimit: 10000`. Option and session-limit endpoints check numeric types, without range checks. Changing the heartbeat interval affects later HELLO frames. The initial session limit has `total: 1000`, `remaining: 1000`, and `maxConcurrency: 1`. Its initial `resetAt` is one day after startup. The fake does not automatically refill remaining sessions.

Session summaries contain `id`, `user_id`, `intents`, `connected`, `seq`, `buffered`, `heartbeats`, `last_heartbeat_at`, `resumes`, and `expired`. Recorded frames contain `at`, `connection`, `session`, `direction`, `op`, `t`, `s`, and `d`. `direction` is `in` or `out`. The frame log retains at most 5,000 records. Raw-text control sends bypass that structured log.
