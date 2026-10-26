---
title: Fake Discord Gateway controls
description: Inspect local Gateway sessions and simulate reconnects, disconnects, invalid sessions, and heartbeat failures.
---

These [local control endpoints](control-seeding.md) have **no authentication**.
They steer the [Gateway WebSocket](gateway.md); they are ordinary HTTP requests.
Every success returns `200` JSON. Invalid typed inputs return `400 {"error":"message"}`.
An action with no connected clients still succeeds.

- [GET /_fake/gateway](control-gateway/get-gateway.md)
- [POST /_fake/gateway/reconnect](control-gateway/post-gateway-reconnect.md)
- [POST /_fake/gateway/close](control-gateway/post-gateway-close.md)
- [POST /_fake/gateway/drop](control-gateway/post-gateway-drop.md)
- [POST /_fake/gateway/invalidate](control-gateway/post-gateway-invalidate.md)
- [POST /_fake/gateway/heartbeats](control-gateway/post-gateway-heartbeats.md)
- [POST /_fake/gateway/next-resume](control-gateway/post-gateway-next-resume.md)
- [POST /_fake/gateway/forget](control-gateway/post-gateway-forget.md)
- [POST /_fake/gateway/raw](control-gateway/post-gateway-raw.md)
- [POST /_fake/gateway/options](control-gateway/post-gateway-options.md)
- [POST /_fake/gateway/session-limit](control-gateway/post-gateway-session-limit.md)

## Defaults and inspection fields

- [GET `/_fake/gateway`](control-gateway/get-gateway.md) returns session summaries and recorded frames.
