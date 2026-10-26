---
title: 'GET /_fake/gateway'
description: Fake Discord Gateway controls endpoint GET /_fake/gateway.
---

[Fake Discord](../index.md) / [Fake Discord Gateway controls](../control-gateway.md)

Implements `GET /_fake/gateway`. It steers the Gateway WebSocket.

## Request

- Method and path: `GET /_fake/gateway`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs and behavior: Query `limit` defaults to `200`; returns the last frames and all session summaries.

## Response

Success returns `200` JSON. An action with no connected clients still succeeds.

`{sessions,frames}`

## Example

Use this request body with the method and path above when the example is body-only.

`GET /_fake/gateway?limit=20`

## Source

[inspection](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L327)

Gateway defaults are `heartbeatIntervalMs: 41250`, `resumeWindowMs: 120000`, `eventLagMs: 0`, and `bufferLimit: 10000`. Option and session-limit endpoints check numeric types, without range checks. Changing the heartbeat interval affects later HELLO frames. The initial session limit has `total: 1000`, `remaining: 1000`, and `maxConcurrency: 1`. Its initial `resetAt` is one day after startup. The fake does not automatically refill remaining sessions.

Session summaries contain `id`, `user_id`, `intents`, `connected`, `seq`, `buffered`, `heartbeats`, `last_heartbeat_at`, `resumes`, and `expired`. Recorded frames contain `at`, `connection`, `session`, `direction`, `op`, `t`, `s`, and `d`. `direction` is `in` or `out`. The frame log retains at most 5,000 records. Raw-text control sends bypass that structured log.

Sources: [options](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L66), [session and frame fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L130), [session summaries](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L186), [frame recording](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L314).
