---
title: 'DELETE /_fake/threads/:id'
description: Fake Discord control actions endpoint DELETE /_fake/threads/:id.
---

[Fake Discord](../index.md) / [Fake Discord control actions](../control-actions.md)

Implements `DELETE /_fake/threads/:id`. This local control endpoint has no authentication.

## Request

- Method and path: `DELETE /_fake/threads/:id`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs: Digit-only thread ID. No body required.

## Response

Success returns `200` JSON.

`{"ok":true}`. Removes the thread, its messages, and memberships. Unknown channel or non-thread returns `400`.

## Example

Use this request body with the method and path above when the example is body-only.

`DELETE /_fake/threads/100000000000000060`

## Source

[thread deletion](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L239)
