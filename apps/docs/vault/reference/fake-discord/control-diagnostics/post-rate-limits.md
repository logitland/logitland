---
title: 'POST /_fake/rate-limits'
description: Fake Discord control endpoint for configuring local REST rate limits.
---

[Fake Discord](../index.md) / [Control diagnostics](../control-diagnostics.md)

Changes rate-limit configuration and clears existing bucket counts. This endpoint has no authentication.

## Request

- Method and path: `POST /_fake/rate-limits`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Body: optional boolean `enforce`, plus `webhook` and `default` bucket patches. Each bucket patch accepts optional numeric `limit` and `windowMs`. Omitted fields keep their current values.

```sh
curl http://127.0.0.1:8790/_fake/rate-limits \
  -H 'Content-Type: application/json' \
  -d '{"enforce":true,"webhook":{"limit":2,"windowMs":1000}}'
```

## Response

Success returns `200` JSON.

Returns the full `{enforce,webhook,default}` configuration with `200` JSON.

Defaults are `enforce: false`, `webhook: {limit:5,windowMs:2000}`, and `default: {limit:50,windowMs:1000}`. The handler passes bucket patches through without range validation. Webhook buckets are shared per webhook ID. Other buckets use the route's major parameter. Enforced exhaustion returns REST `429` with `message`, `retry_after` seconds, and `global: false`.

Sources: [rate-limit endpoint](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L441), [configuration defaults](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L149), [bucket keys](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L465).
