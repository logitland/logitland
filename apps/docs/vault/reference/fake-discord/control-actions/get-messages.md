---
title: 'GET /_fake/messages'
description: Fake Discord control actions endpoint GET /_fake/messages.
---

[Fake Discord](../index.md) / [Fake Discord control actions](../control-actions.md)

Implements `GET /_fake/messages`. This local control endpoint has no authentication.

## Request

- Method and path: `GET /_fake/messages`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: Required query `channel`. Optional `webhook=1` restricts results to webhook messages.

## Response

Success returns `200` JSON.

`{messages: Message[]}`, oldest first, with full content. Unknown channel or absent query returns `400`.

## Example

Use this request body with the method and path above when the example is body-only.

`GET /_fake/messages?channel=100000000000000020&webhook=1`

## Source

[message reads](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L214)
