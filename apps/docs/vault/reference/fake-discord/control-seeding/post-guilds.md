---
title: 'POST /_fake/guilds'
description: Fake Discord control seeding endpoint POST /_fake/guilds.
---

[Fake Discord](../index.md) / [Fake Discord control seeding](../control-seeding.md)

Implements `POST /_fake/guilds`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/guilds`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: Optional strings `id`, `name`, `owner_id`. Name defaults to `Test server`. IDs and owner otherwise generate.

## Response

Success returns `200` JSON.

`{id,name,everyone_role_id,bot_role_id,owner_id}`. Adds owner and bot members, @everyone, and the bot role at position 10.

## Example

Use this request body with the method and path above when the example is body-only.

`{"id":"100000000000000010","name":"Test server"}`

## Source

[guilds](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L121)
