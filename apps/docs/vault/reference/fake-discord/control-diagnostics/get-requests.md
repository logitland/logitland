---
title: 'GET /_fake/requests'
description: Fake Discord control diagnostics endpoint GET /_fake/requests.
---

[Fake Discord](../index.md) / [Fake Discord control diagnostics](../control-diagnostics.md)

Implements `GET /_fake/requests`. This local control endpoint has no authentication.

## Request

- Method and path: `GET /_fake/requests`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs and behavior: Optional query `route` selects a name or trailing-`*` prefix. `since` defaults to `0` and selects request numbers greater than that value. `limit` defaults to `500` and selects the last matching entries.

## Response

Success returns `200` JSON.

`{requests: RecordedRequest[]}`

## Example

Use this request body with the method and path above when the example is body-only.

`GET /_fake/requests?route=webhook.*&since=0&limit=20`

## Source

[request log](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L278)

A RecordedRequest contains `n`, `at`, `route`, `method`, `path`, `query`, `headers`, `body`, `status`, `reply`, `injected`, and `params`. `path` excludes the API prefix and query. Header names are lowercase. A dropped connection records `status: 0`; `injected` names the applied failure behavior or is `null`. Unknown REST routes also enter the log. Control and OAuth handlers bypass it.

Sources: [record fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L90), [HTTP dispatcher](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L501).
