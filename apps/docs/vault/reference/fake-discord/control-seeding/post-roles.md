---
title: 'POST /_fake/roles'
description: Fake Discord control seeding endpoint POST /_fake/roles.
---

[Fake Discord](../index.md) / [Fake Discord control seeding](../control-seeding.md)

Implements `POST /_fake/roles`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/roles`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: Required `guild`, `name`. Optional `id`, decimal-string `permissions` (default `"0"`), numeric `position` (default `1`).

## Response

Success returns `200` JSON.

Role object. Unknown guild returns `400` with `error: "Unknown Guild"`.

## Example

Use this request body with the method and path above when the example is body-only.

`{"guild":"100000000000000010","id":"100000000000000040","name":"Mirror","position":5}`

## Source

[roles](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L153)
