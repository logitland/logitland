---
title: 'DELETE /_fake/requests'
description: Fake Discord control diagnostics endpoint DELETE /_fake/requests.
---

[Fake Discord](../index.md) / [Fake Discord control diagnostics](../control-diagnostics.md)

Implements `DELETE /_fake/requests`. This local control endpoint has no authentication.

## Request

- Method and path: `DELETE /_fake/requests`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs and behavior: No body required. Clears only REST request records.

## Response

Success returns `200` JSON.

`{"ok":true}`

## Example

Use this request body with the method and path above when the example is body-only.

`DELETE /_fake/requests`

## Source

[clear requests](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L289)
