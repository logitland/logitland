---
title: 'POST /_fake/gateway/session-limit'
description: Fake Discord Gateway controls endpoint POST /_fake/gateway/session-limit.
---

[Fake Discord](../index.md) / [Fake Discord Gateway controls](../control-gateway.md)

Implements `POST /_fake/gateway/session-limit`. It steers the Gateway WebSocket.

## Request

- Method and path: `POST /_fake/gateway/session-limit`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs: Optional numeric `remaining`; optional `reset_after_ms` sets `resetAt` relative to the current clock. Omitted fields stay unchanged.

## Response

Success returns `200` JSON. An action with no connected clients still succeeds.

`{total,remaining,resetAt,maxConcurrency}`. `resetAt` is epoch milliseconds.

## Example

Use this request body with the method and path above when the example is body-only.

`{"remaining":0,"reset_after_ms":1000}`

## Source

[session limit](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L412)
