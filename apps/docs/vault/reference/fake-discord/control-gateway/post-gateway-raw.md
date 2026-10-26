---
title: 'POST /_fake/gateway/raw'
description: Fake Discord Gateway controls endpoint POST /_fake/gateway/raw.
---

[Fake Discord](../index.md) / [Fake Discord Gateway controls](../control-gateway.md)

Implements `POST /_fake/gateway/raw`. It steers the Gateway WebSocket.

## Request

- Method and path: `POST /_fake/gateway/raw`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs: Required string `text`. Sends literal WebSocket text to authenticated clients, without frame validation.

## Response

Success returns `200` JSON. An action with no connected clients still succeeds.

`{"ok":true}`

## Example

Use this request body with the method and path above when the example is body-only.

`{"text":"not JSON"}`

## Source

[raw text](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L393)
