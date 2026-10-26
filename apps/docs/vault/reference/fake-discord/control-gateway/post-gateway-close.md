---
title: 'POST /_fake/gateway/close'
description: Fake Discord Gateway controls endpoint POST /_fake/gateway/close.
---

[Fake Discord](../index.md) / [Fake Discord Gateway controls](../control-gateway.md)

Implements `POST /_fake/gateway/close`. It steers the Gateway WebSocket.

## Request

- Method and path: `POST /_fake/gateway/close`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs and behavior: Optional numeric `code` defaults to `4000`; string `reason` defaults to `""`; `forget` defaults to `false`. Closes all sockets.

## Response

Success returns `200` JSON. An action with no connected clients still succeeds.

`{"ok":true}`

## Example

Use this request body with the method and path above when the example is body-only.

`{"code":4009,"reason":"Test timeout","forget":true}`

## Source

[close](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L343)

Close codes `4003`, `4007`, and `4009` expire sessions, even with `forget: false`. Other control closes preserve resumability unless `forget: true`.

Source: [Gateway control methods](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L216).
