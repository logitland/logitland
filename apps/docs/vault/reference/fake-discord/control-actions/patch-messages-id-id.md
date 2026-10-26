---
title: 'PATCH /_fake/messages/:channel/:id'
description: Fake Discord control actions endpoint PATCH /_fake/messages/:channel/:id.
---

[Fake Discord](../index.md) / [Fake Discord control actions](../control-actions.md)

Implements `PATCH /_fake/messages/:channel/:id`. This local control endpoint has no authentication.

## Request

- Method and path: `PATCH /_fake/messages/:channel/:id`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: Required string `content`. Both path IDs contain digits.

## Response

Success returns `200` JSON.

Edited Message. Missing message returns `400`, error `Unknown Message`.

## Example

Use this request body with the method and path above when the example is body-only.

`PATCH /_fake/messages/100000000000000020/100000000000000060` with `{"content":"Edited by Alice"}`.

## Source

[message edit](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L203)
