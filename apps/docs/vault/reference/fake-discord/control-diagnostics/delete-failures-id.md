---
title: 'DELETE /_fake/failures/:id'
description: Fake Discord control diagnostics endpoint DELETE /_fake/failures/:id.
---

[Fake Discord](../index.md) / [Fake Discord control diagnostics](../control-diagnostics.md)

Implements `DELETE /_fake/failures/:id`. This local control endpoint has no authentication.

## Request

- Method and path: `DELETE /_fake/failures/:id`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs and behavior: Digit-only rule ID. Removes that rule; an unknown ID also succeeds.

## Response

Success returns `200` JSON.

`{"ok":true}`

## Example

Use this request body with the method and path above when the example is body-only.

`DELETE /_fake/failures/1`

## Source

[remove rule](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L315)
