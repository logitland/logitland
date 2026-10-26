---
title: 'POST /_fake/messages/bulk-delete'
description: Fake Discord control actions endpoint POST /_fake/messages/bulk-delete.
---

[Fake Discord](../index.md) / [Fake Discord control actions](../control-actions.md)

Implements `POST /_fake/messages/bulk-delete`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/messages/bulk-delete`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: Required `channel` string and `ids` array.

## Response

Success returns `200` JSON.

`{"ok":true}`. Emits `MESSAGE_DELETE_BULK`.

## Example

Use this request body with the method and path above when the example is body-only.

`{"channel":"100000000000000020","ids":["100000000000000060","100000000000000061"]}`

## Source

[bulk delete](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L194)
