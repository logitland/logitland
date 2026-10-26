---
title: POST /v1/delivery/rotate-secret
description: 'No body or query fields.'
---

[subscriptions](../subscriptions.md) · [Public API](../index.md)

Requires an active agent token.

No body or query fields.
Returns a new signing secret once.
The previous secret keeps signing alongside it for 24 hours.

```sh
curl -X POST https://relay.example/v1/delivery/rotate-secret -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `200`:

```json
{ "secret": "whsec_new_example", "previous_valid_until": "2026-10-26T12:00:00.000Z" }
```

No webhook returns `404`. A concurrent rotation returns `409`.
Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L77),
[rotation](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/webhook.ts#L207).
