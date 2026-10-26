---
title: 'POST /_fake/clear'
description: Fake Discord control diagnostics endpoint POST /_fake/clear.
---

[Fake Discord](../index.md) / [Fake Discord control diagnostics](../control-diagnostics.md)

Implements `POST /_fake/clear`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/clear`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs and behavior: Optional `messages`, default `false`. Clears requests, Gateway frame log, failure rules, and rate buckets. `messages: true` also clears stored messages and threads.

## Response

Success returns `200` JSON.

`{"ok":true}`

## Example

Use this request body with the method and path above when the example is body-only.

`POST /_fake/clear` with `{"messages":true}`.

## Source

[clear](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L110)

Clearing logs does not reset request numbers, OAuth tokens, interactions, guilds, or Gateway sessions.

Source: [reset](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L405).
