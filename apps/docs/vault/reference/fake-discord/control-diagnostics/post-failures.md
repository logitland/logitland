---
title: 'POST /_fake/failures'
description: Fake Discord control diagnostics endpoint POST /_fake/failures.
---

[Fake Discord](../index.md) / [Fake Discord control diagnostics](../control-diagnostics.md)

Implements `POST /_fake/failures`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/failures`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs and behavior: Required object `behaviour` with supported `type`. Optional object `match` defaults to matching everything. `times` defaults to `1`; accepts a number or `"forever"`.

## Response

Success returns `200` JSON.

`{id}`. Unsupported type returns `400`.

## Example

Use this request body with the method and path above when the example is body-only.

`{"match":{"route":"webhook.execute"},"behaviour":{"type":"rate_limit","retryAfter":1.5},"times":1}`

## Source

[add rule](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L302)

Match fields are optional strings `route`, `method`, `path`, `channelId`, and `webhookId`. `route` accepts an exact name or trailing-`*` prefix; `path` is exact and excludes the API prefix. `method` compares case-insensitively. All supplied match fields must match. For webhook requests, `channelId` refers to the webhook's channel, even when the request targets a thread. The first matching unexhausted rule wins. Exhausted rules stay visible until removed.

| `behaviour.type` | Fields and result                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rate_limit`     | Optional `retryAfter` seconds (default `1`), `global` (default `false`), `scope` (`user`, `global`, or `shared`). Returns `429` without processing. Default scope follows `global`. |
| `status`         | Optional numeric `status` (default `500`) and arbitrary `body`. Returns them without processing. Default body is `{message,code:0}`.                                                |
| `slow`           | Required `ms`; `phase` defaults to `before`. `after` delays the response after processing.                                                                                          |
| `drop`           | `phase` defaults to `before`. Drops the socket without a response. `after` processes first.                                                                                         |

For example, simulate a write succeeding before its connection disappears:

```json
{
  "match": { "route": "webhook.execute" },
  "behaviour": { "type": "drop", "phase": "after" }
}
```

Source: [failure matching and application](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L419).
