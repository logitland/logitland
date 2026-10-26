---
title: 'PATCH /_fake/application'
description: Fake Discord control endpoint that changes local application settings.
---

[Fake Discord](../index.md) / [Control seeding](../control-seeding.md)

Changes supplied application fields and returns the fake's stored application object. This endpoint has no authentication.

## Request

- Method and path: `PATCH /_fake/application`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Body: JSON object. Supported fields:

| Field                       | Behavior                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `interactions_endpoint_url` | Sets the endpoint receiving simulated interactions. `null` or an empty value clears it.              |
| `team`                      | Array of developer user IDs. `null` clears the team.                                                 |
| `messageContent`            | `limited`, `full`, or `off`. Sets flags to `524288`, `262144`, or `0`. Invalid strings return `400`. |

```sh
curl -X PATCH http://127.0.0.1:8790/_fake/application \
  -H 'Content-Type: application/json' \
  -d '{"interactions_endpoint_url":"http://127.0.0.1:8787/v1/discord/interactions","messageContent":"limited"}'
```

## Response

Success returns `200` JSON.

Success returns `200` JSON with `id`, `name`, `flags`, `interactions_endpoint_url`, `owner_id`, and `team`. These are the fake's stored fields, distinct from `GET /api/v10/applications/@me`'s expanded object.

Source: [application patch](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L426).
