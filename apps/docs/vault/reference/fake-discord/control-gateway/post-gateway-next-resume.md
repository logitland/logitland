---
title: 'POST /_fake/gateway/next-resume'
description: Fake Discord Gateway controls endpoint POST /_fake/gateway/next-resume.
---

[Fake Discord](../index.md) / [Fake Discord Gateway controls](../control-gateway.md)

Implements `POST /_fake/gateway/next-resume`. It steers the Gateway WebSocket.

## Request

- Method and path: `POST /_fake/gateway/next-resume`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs: Required string `mode`: `ok`, `invalid`, or `invalid-resumable`. Applies once to the next well-formed, correctly authenticated RESUME. Other values return `400`.

## Response

Success returns `200` JSON. An action with no connected clients still succeeds.

`{mode}`

## Example

Use this request body with the method and path above when the example is body-only.

`{"mode":"invalid-resumable"}`

## Source

[next resume](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L375)
