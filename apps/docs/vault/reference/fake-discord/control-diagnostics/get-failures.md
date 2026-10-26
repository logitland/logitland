---
title: 'GET /_fake/failures'
description: Fake Discord control diagnostics endpoint GET /_fake/failures.
---

[Fake Discord](../index.md) / [Fake Discord control diagnostics](../control-diagnostics.md)

Implements `GET /_fake/failures`. This local control endpoint has no authentication.

## Request

- Method and path: `GET /_fake/failures`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs and behavior: No inputs. Lists rules, including their match, behavior, remaining configuration, and hits.

## Response

Success returns `200` JSON.

`{failures: [{id,match,behaviour,times,hits}]}`. Infinite `times` appears as `"forever"`.

## Example

Use this request body with the method and path above when the example is body-only.

`GET /_fake/failures`

## Source

[list rules](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L300)
