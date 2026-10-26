---
title: 'PATCH /_fake/threads/:id'
description: Fake Discord control actions endpoint PATCH /_fake/threads/:id.
---

[Fake Discord](../index.md) / [Fake Discord control actions](../control-actions.md)

Implements `PATCH /_fake/threads/:id`. This local control endpoint has no authentication.

## Request

- Method and path: `PATCH /_fake/threads/:id`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs: Digit-only thread ID. Optional string `name`, booleans `archived` and `locked`, array `tags`. Omitted fields stay unchanged.

## Response

Success returns `200` JSON.

Updated Channel. Unknown channel or non-thread returns `400`.

## Example

Use this request body with the method and path above when the example is body-only.

`PATCH /_fake/threads/100000000000000060` with `{"archived":true,"locked":true}`.

## Source

[thread edit](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L227)

Control thread edits pass tags straight to the world without REST's tag validation.

Source: [thread mutations](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L644).
