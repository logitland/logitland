---
title: 'POST /_fake/members'
description: Fake Discord control seeding endpoint POST /_fake/members.
---

[Fake Discord](../index.md) / [Fake Discord control seeding](../control-seeding.md)

Implements `POST /_fake/members`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/members`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: Required `guild`. Optional `id`, `username`, `global_name`, array `roles` (default `[]`). Username defaults to `user-<ID suffix or user count>`.

## Response

Success returns `200` JSON.

`{id,username,roles}`. Unknown guild/role returns `400` with its error message.

## Example

Use this request body with the method and path above when the example is body-only.

`{"guild":"100000000000000010","id":"100000000000000030","username":"alice"}`

## Source

[members](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L162)
