---
title: 'POST /_fake/messages'
description: Fake Discord control actions endpoint POST /_fake/messages.
---

[Fake Discord](../index.md) / [Fake Discord control actions](../control-actions.md)

Implements `POST /_fake/messages`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/messages`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: Required strings `channel`, `as` (existing user ID), `content`. Optional `reply_to`, numeric `type`, `thread_name`, array `tags`.

## Response

Success returns `200` JSON.

Message. A forum/media channel requires `thread_name` and creates a post. Unknown user/channel or missing forum thread name returns `400`.

## Example

Use this request body with the method and path above when the example is body-only.

`{"channel":"100000000000000020","as":"100000000000000030","content":"Hello"}`

## Source

[messages](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L180)

`reply_to` adds a message reference and defaults the message type to `19`. Other numeric `type` values can simulate system messages. Forum posts use `tags` as the applied tag IDs.

Sources: [person message behavior](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L342), [world message mutations](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L477).
