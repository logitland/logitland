---
title: 'POST /_fake/gateway/heartbeats'
description: Fake Discord Gateway controls endpoint POST /_fake/gateway/heartbeats.
---

[Fake Discord](../index.md) / [Fake Discord Gateway controls](../control-gateway.md)

Implements `POST /_fake/gateway/heartbeats`. It steers the Gateway WebSocket.

## Request

- Method and path: `POST /_fake/gateway/heartbeats`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs and behavior: ACKs remain enabled unless `ack` is exactly `false`.

## Response

Success returns `200` JSON. An action with no connected clients still succeeds.

`{ack}`

## Example

Use this request body with the method and path above when the example is body-only.

`{"ack":false}`

## Source

[heartbeats](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L367)
