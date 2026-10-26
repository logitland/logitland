---
title: 'POST /_fake/gateway/reconnect'
description: Fake Discord Gateway controls endpoint POST /_fake/gateway/reconnect.
---

[Fake Discord](../index.md) / [Fake Discord Gateway controls](../control-gateway.md)

Implements `POST /_fake/gateway/reconnect`. It steers the Gateway WebSocket.

## Request

- Method and path: `POST /_fake/gateway/reconnect`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs and behavior: No body required. Sends opcode `7` to authenticated clients without closing their sockets.

## Response

Success returns `200` JSON. An action with no connected clients still succeeds.

`{"ok":true}`

## Example

Use this request body with the method and path above when the example is body-only.

`POST /_fake/gateway/reconnect` with `{}`.

## Source

[reconnect](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L335)
