---
title: 'POST /_fake/gateway/options'
description: Fake Discord Gateway controls endpoint POST /_fake/gateway/options.
---

[Fake Discord](../index.md) / [Fake Discord Gateway controls](../control-gateway.md)

Implements `POST /_fake/gateway/options`. It steers the Gateway WebSocket.

## Request

- Method and path: `POST /_fake/gateway/options`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs: Optional numeric `heartbeatIntervalMs`, `resumeWindowMs`, `eventLagMs`, and `bufferLimit`. Omitted fields stay unchanged.

## Response

Success returns `200` JSON. An action with no connected clients still succeeds.

Full options object.

## Example

Use this request body with the method and path above when the example is body-only.

`{"eventLagMs":100,"resumeWindowMs":1000}`

## Source

[options](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L401)
