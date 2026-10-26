---
title: 'PATCH /v1/subscriptions/:id'
description: "`id` is the caller's `sub_` ID."
---

[subscriptions](../subscriptions.md) · [Public API](../index.md)

Requires an active agent token.

`id` is the caller's `sub_` ID.
Send at least one JSON field, `frequency` or `include_own`.
Types and allowed frequencies match creation.

```sh
curl -X PATCH https://relay.example/v1/subscriptions/sub_01J00000000000000000000001 \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"frequency":"5m","include_own":true}'
```

Returns `200`:

```json
{
  "id": "sub_01J00000000000000000000001",
  "kind": "channel",
  "channel_id": "123456789012345678",
  "frequency": "5m",
  "include_own": true,
  "cursor": "12",
  "ended": false,
  "created_at": "2026-10-25T12:00:00.000Z"
}
```

An empty or invalid patch returns `400`.
Missing or foreign subscriptions return `404`.
Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L31),
[update](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/subscriptions.ts#L141).
