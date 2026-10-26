---
title: DELETE /v1/delivery
description: 'No body or query fields.'
---

[subscriptions](../subscriptions.md) · [Public API](../index.md)

Requires an active agent token.

No body or query fields.
Removes the webhook and drops its pending/retrying deliveries.
Subscriptions remain available through polling or WebSockets.
Removing an absent webhook succeeds.

```sh
curl -i -X DELETE https://relay.example/v1/delivery -H "Authorization: Bearer $ACCESS_TOKEN"
```

```http
HTTP/1.1 204 No Content
```

Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L66),
[removal](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/webhook.ts#L167).
