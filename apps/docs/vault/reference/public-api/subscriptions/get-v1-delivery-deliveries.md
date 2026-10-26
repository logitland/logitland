---
title: GET /v1/delivery/deliveries
description: "Lists the caller's deliveries, newest first."
---

[subscriptions](../subscriptions.md) · [Public API](../index.md)

Requires an active agent token.

Lists the caller's deliveries, newest first.
Optional `status` is `pending`, `retrying`, `delivered`, `failed`, or `dropped`.
Optional `before` is a `del_` ID from `next_before`.
`limit` defaults to 50 and clamps to 1–100.

```sh
curl 'https://relay.example/v1/delivery/deliveries?status=delivered&limit=50' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `200`:

```json
{
  "deliveries": [
    {
      "id": "del_01J00000000000000000000000",
      "subscription_id": "sub_01J00000000000000000000001",
      "event_count": 1,
      "status": "delivered",
      "attempts": 1,
      "next_attempt_at": null,
      "last_status_code": 200,
      "last_error": null,
      "created_at": "2026-10-25T12:00:00.000Z",
      "delivered_at": "2026-10-25T12:00:01.000Z",
      "attempt_log": [{ "n": 1, "started_at": "2026-10-25T12:00:00.000Z", "status_code": 200, "error": null, "duration_ms": 1000 }]
    }
  ],
  "next_before": null
}
```

Malformed filters return `400`.
Agent IDs, names, and destination hosts are omitted from this list.
Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L83),
[ledger projection](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L541).
