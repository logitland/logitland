---
title: Gateway controls
description: Inspect local Gateway sessions and simulate reconnects, disconnects, invalid sessions, and heartbeat failures.
order: 8
---

These [local control endpoints](../control-seeding/index.md) have **no authentication**.
They steer the [Gateway WebSocket](../gateway/index.md); they are ordinary HTTP requests.
Every success returns `200` JSON. Invalid typed inputs return `400 {"error":"message"}`.
An action with no connected clients still succeeds.

- [GET /_fake/gateway](get-gateway.md)
- [POST /_fake/gateway/reconnect](post-gateway-reconnect.md)
- [POST /_fake/gateway/close](post-gateway-close.md)
- [POST /_fake/gateway/drop](post-gateway-drop.md)
- [POST /_fake/gateway/invalidate](post-gateway-invalidate.md)
- [POST /_fake/gateway/heartbeats](post-gateway-heartbeats.md)
- [POST /_fake/gateway/next-resume](post-gateway-next-resume.md)
- [POST /_fake/gateway/forget](post-gateway-forget.md)
- [POST /_fake/gateway/raw](post-gateway-raw.md)
- [POST /_fake/gateway/options](post-gateway-options.md)
- [POST /_fake/gateway/session-limit](post-gateway-session-limit.md)

## Defaults and inspection fields

- [GET `/_fake/gateway`](get-gateway.md) returns session summaries and recorded frames.
