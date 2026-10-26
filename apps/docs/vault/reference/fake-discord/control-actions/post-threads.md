---
title: 'POST /_fake/threads'
description: Fake Discord control actions endpoint POST /_fake/threads.
---

[Fake Discord](../index.md) / [Fake Discord control actions](../control-actions.md)

Implements `POST /_fake/threads`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/threads`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: Required strings `channel`, `message`, `name`. Optional existing user ID `as`; defaults to the bot.

## Response

Success returns `200` JSON.

Thread Channel. Wrong parent type, missing starter, or existing thread returns `400`.

## Example

Use this request body with the method and path above when the example is body-only.

`{"channel":"100000000000000020","message":"100000000000000060","name":"Discussion","as":"100000000000000030"}`

## Source

[thread creation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L225)
