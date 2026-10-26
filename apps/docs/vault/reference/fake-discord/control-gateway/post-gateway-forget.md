---
title: 'POST /_fake/gateway/forget'
description: Fake Discord Gateway controls endpoint POST /_fake/gateway/forget.
---

[Fake Discord](../index.md) / [Fake Discord Gateway controls](../control-gateway.md)

Implements `POST /_fake/gateway/forget`. It steers the Gateway WebSocket.

## Request

- Method and path: `POST /_fake/gateway/forget`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs: No body required. Marks all sessions expired. Their next RESUME gets opcode `9`, `d: false`.

## Response

Success returns `200` JSON. An action with no connected clients still succeeds.

`{"ok":true}`

## Example

Use this request body with the method and path above when the example is body-only.

`POST /_fake/gateway/forget` with `{}`.

## Source

[forget](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L385)
