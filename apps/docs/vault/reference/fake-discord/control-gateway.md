---
title: Fake Discord Gateway controls
description: Inspect local Gateway sessions and simulate reconnects, disconnects, invalid sessions, and heartbeat failures.
---

These [local control endpoints](control-seeding.md) have **no authentication**.
They steer the [Gateway WebSocket](gateway.md); they are ordinary HTTP requests.
Every success returns `200` JSON. Invalid typed inputs return `400 {"error":"message"}`.
An action with no connected clients still succeeds.

| Method and path                     | Required/default inputs and behavior                                                                                                                              | Success JSON                                                                 | Concrete example                                      | Source                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /_fake/gateway`                | Query `limit` defaults to `200`; returns the last frames and all session summaries.                                                                               | `{sessions,frames}`                                                          | `GET /_fake/gateway?limit=20`                         | [inspection](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L327)    |
| `POST /_fake/gateway/reconnect`     | No body required. Sends opcode `7` to authenticated clients without closing their sockets.                                                                        | `{"ok":true}`                                                                | `POST /_fake/gateway/reconnect` with `{}`.            | [reconnect](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L335)     |
| `POST /_fake/gateway/close`         | Optional numeric `code` defaults to `4000`; string `reason` defaults to `""`; `forget` defaults to `false`. Closes all sockets.                                   | `{"ok":true}`                                                                | `{"code":4009,"reason":"Test timeout","forget":true}` | [close](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L343)         |
| `POST /_fake/gateway/drop`          | No body required. Terminates all sockets without close frames.                                                                                                    | `{"ok":true}`                                                                | `POST /_fake/gateway/drop` with `{}`.                 | [drop](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L351)          |
| `POST /_fake/gateway/invalidate`    | `resumable` defaults to `false`. Sends opcode `9` with that boolean to authenticated clients; keeps sockets open.                                                 | `{"ok":true}`                                                                | `{"resumable":true}`                                  | [invalidate](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L359)    |
| `POST /_fake/gateway/heartbeats`    | ACKs remain enabled unless `ack` is exactly `false`.                                                                                                              | `{ack}`                                                                      | `{"ack":false}`                                       | [heartbeats](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L367)    |
| `POST /_fake/gateway/next-resume`   | Required string `mode`: `ok`, `invalid`, or `invalid-resumable`. Applies once to the next well-formed, correctly authenticated RESUME. Other values return `400`. | `{mode}`                                                                     | `{"mode":"invalid-resumable"}`                        | [next resume](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L375)   |
| `POST /_fake/gateway/forget`        | No body required. Marks all sessions expired. Their next RESUME gets opcode `9`, `d: false`.                                                                      | `{"ok":true}`                                                                | `POST /_fake/gateway/forget` with `{}`.               | [forget](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L385)        |
| `POST /_fake/gateway/raw`           | Required string `text`. Sends literal WebSocket text to authenticated clients, without frame validation.                                                          | `{"ok":true}`                                                                | `{"text":"not JSON"}`                                 | [raw text](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L393)      |
| `POST /_fake/gateway/options`       | Optional numeric `heartbeatIntervalMs`, `resumeWindowMs`, `eventLagMs`, and `bufferLimit`. Omitted fields stay unchanged.                                         | Full options object.                                                         | `{"eventLagMs":100,"resumeWindowMs":1000}`            | [options](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L401)       |
| `POST /_fake/gateway/session-limit` | Optional numeric `remaining`; optional `reset_after_ms` sets `resetAt` relative to the current clock. Omitted fields stay unchanged.                              | `{total,remaining,resetAt,maxConcurrency}`. `resetAt` is epoch milliseconds. | `{"remaining":0,"reset_after_ms":1000}`               | [session limit](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L412) |

Each body-only example goes to the method and path in its row.
For example:

```sh
curl http://127.0.0.1:8790/_fake/gateway/heartbeats \
  -H 'Content-Type: application/json' \
  -d '{"ack":false}'
```

Close codes `4003`, `4007`, and `4009` expire sessions, even with `forget: false`.
Other control closes preserve resumability unless `forget: true`.
Dropping sockets also preserves sessions until their resume window expires.

Source: [Gateway control methods](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L216).

## Defaults and inspection fields

Gateway defaults are `heartbeatIntervalMs: 41250`, `resumeWindowMs: 120000`, `eventLagMs: 0`, and `bufferLimit: 10000`.
Option and session-limit endpoints check numeric types, without range checks.
Changing the heartbeat interval affects later HELLO frames.
The initial session limit has `total: 1000`, `remaining: 1000`, and `maxConcurrency: 1`.
Its initial `resetAt` is one day after startup. The fake does not automatically refill remaining sessions.

Session summaries contain `id`, `user_id`, `intents`, `connected`, `seq`, `buffered`, `heartbeats`, `last_heartbeat_at`, `resumes`, and `expired`.
Recorded frames contain `at`, `connection`, `session`, `direction`, `op`, `t`, `s`, and `d`.
`direction` is `in` or `out`. The frame log retains at most 5,000 records.
Raw-text control sends bypass that structured log.

Sources: [options](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L66),
[session and frame fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L130),
[session summaries](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L186),
[frame recording](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L314).
