---
title: 'DELETE /_fake/messages/:channel/:id'
description: Fake Discord control actions endpoint DELETE /_fake/messages/:channel/:id.
---

[Fake Discord](../index.md) / [Fake Discord control actions](../control-actions.md)

Implements `DELETE /_fake/messages/:channel/:id`. This local control endpoint has no authentication.

## Request

- Method and path: `DELETE /_fake/messages/:channel/:id`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: Digit-only path IDs. No body required.

## Response

Success returns `200` JSON.

`{"ok":true}`. Missing message returns `400`, error `Unknown Message`.

## Example

Use this request body with the method and path above when the example is body-only.

`DELETE /_fake/messages/100000000000000020/100000000000000060`

## Source

[message delete](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L205)
