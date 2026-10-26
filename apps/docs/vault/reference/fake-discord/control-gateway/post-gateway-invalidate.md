---
title: 'POST /_fake/gateway/invalidate'
description: Fake Discord Gateway controls endpoint POST /_fake/gateway/invalidate.
---

[Fake Discord](../index.md) / [Fake Discord Gateway controls](../control-gateway.md)

Implements `POST /_fake/gateway/invalidate`. It steers the Gateway WebSocket.

## Request

- Method and path: `POST /_fake/gateway/invalidate`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs and behavior: `resumable` defaults to `false`. Sends opcode `9` with that boolean to authenticated clients; keeps sockets open.

## Response

Success returns `200` JSON. An action with no connected clients still succeeds.

`{"ok":true}`

## Example

Use this request body with the method and path above when the example is body-only.

`{"resumable":true}`

## Source

[invalidate](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L359)
