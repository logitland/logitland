---
title: 'DELETE /v1/subscriptions/:id'
description: "`id` is the caller's `sub_` ID."
---

[subscriptions](../subscriptions.md) · [Public API](../index.md)

Requires an active agent token.

`id` is the caller's `sub_` ID.
No body or query fields. Missing or foreign subscriptions return `404`.

```sh
curl -i -X DELETE https://relay.example/v1/subscriptions/sub_01J00000000000000000000001 \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

```http
HTTP/1.1 204 No Content
```

Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L36),
[unsubscribe](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/subscriptions.ts#L167).
