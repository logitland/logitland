---
title: Gateway controls
description: Inspect local Gateway sessions and simulate reconnects, disconnects, invalid sessions, and heartbeat failures.
order: 8
---

These [local control endpoints](../control-seeding/index.md) have **no authentication**.
Keep the fake on loopback; these controls can disrupt every client and expose bot tokens in recorded frames.
They are ordinary HTTP requests that steer the [Gateway WebSocket](../gateway/index.md), not WebSocket messages.

Every success returns `200` JSON. Malformed JSON and rejected inputs return `400 {"error":"message"}`; not every field is strictly validated.
An empty request body becomes `{}`. Actions still succeed with no connected clients.

| Endpoint                                                           | Purpose                                         |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| [GET /_fake/gateway](get-gateway.md)                               | Inspect sessions and recorded frames.           |
| [POST /_fake/gateway/reconnect](post-gateway-reconnect.md)         | Send RECONNECT without closing sockets.         |
| [POST /_fake/gateway/close](post-gateway-close.md)                 | Close sockets with a code and reason.           |
| [POST /_fake/gateway/drop](post-gateway-drop.md)                   | Terminate sockets without close frames.         |
| [POST /_fake/gateway/invalidate](post-gateway-invalidate.md)       | Send INVALID_SESSION without closing sockets.   |
| [POST /_fake/gateway/heartbeats](post-gateway-heartbeats.md)       | Enable or disable heartbeat ACKs.               |
| [POST /_fake/gateway/next-resume](post-gateway-next-resume.md)     | Override the next eligible RESUME result.       |
| [POST /_fake/gateway/forget](post-gateway-forget.md)               | Expire all sessions.                            |
| [POST /_fake/gateway/raw](post-gateway-raw.md)                     | Send literal text to authenticated clients.     |
| [POST /_fake/gateway/options](post-gateway-options.md)             | Change timing and replay-buffer options.        |
| [POST /_fake/gateway/session-limit](post-gateway-session-limit.md) | Change session starts remaining and reset time. |

## Defaults and inspection fields

[Inspect sessions and frames](get-gateway.md), or check the defaults for [Gateway options](post-gateway-options.md) and the [session start limit](post-gateway-session-limit.md).
