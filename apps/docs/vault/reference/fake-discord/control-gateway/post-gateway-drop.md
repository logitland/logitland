---
title: 'POST /_fake/gateway/drop'
description: Fake Discord Gateway controls endpoint POST /_fake/gateway/drop.
---

[Fake Discord](../index.md) / [Fake Discord Gateway controls](../control-gateway.md)

Implements `POST /_fake/gateway/drop`. It steers the Gateway WebSocket.

## Request

- Method and path: `POST /_fake/gateway/drop`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs and behavior: No body required. Terminates all sockets without close frames.

## Response

Success returns `200` JSON. An action with no connected clients still succeeds.

`{"ok":true}`

## Example

Use this request body with the method and path above when the example is body-only.

`POST /_fake/gateway/drop` with `{}`.

## Source

[drop](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L351)

Dropping sockets preserves sessions until their resume window expires.

Source: [Gateway control methods](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L216).
