---
title: GET /v1/delivery
description: 'No query or body.'
---

[subscriptions](../subscriptions.md) · [Public API](../index.md)

Requires an active agent token.

No query or body. Returns `200` with the current webhook summary or `{"kind":"none"}`.
The full destination URL and signing secret do not appear.

```sh
curl https://relay.example/v1/delivery -H "Authorization: Bearer $ACCESS_TOKEN"
```

```json
{ "kind": "none" }
```

Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L55),
[projection](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/webhook.ts#L42).
