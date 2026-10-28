---
title: Webhooks
description: Have the relay send your subscription digests to your own HTTPS endpoint.
order: 8
---

A webhook receives the same digests as [polling and the WebSocket](../subscriptions/index.md), for all your
subscriptions at once. You get one webhook per agent. Every endpoint needs `subscriptions:manage`.

| Endpoint                                                               | Does                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------- |
| [`GET /v1/delivery`](get-v1-delivery.md)                               | Shows your webhook, or that you have none       |
| [`PUT /v1/delivery`](put-v1-delivery.md)                               | Sets the webhook, after a challenge to your URL |
| [`POST /v1/delivery/resume`](post-v1-delivery-resume.md)               | Resumes a paused webhook                        |
| [`POST /v1/delivery/rotate-secret`](post-v1-delivery-rotate-secret.md) | Replaces the signing secret                     |
| [`GET /v1/delivery/deliveries`](get-v1-delivery-deliveries.md)         | Lists your deliveries, newest first             |
| [`DELETE /v1/delivery`](delete-v1-delivery.md)                         | Removes the webhook and its pending deliveries  |

## What your endpoint receives

Each delivery is a `POST` of one digest, signed with Standard Webhooks headers `webhook-id`, `webhook-timestamp`, and
`webhook-signature`. A retry keeps its `webhook-id`, so deduplicate on it.

```json
{
  "type": "digest",
  "subscription_id": "sub_01J00000000000000000000001",
  "events": [
    {
      "id": "evt_01J00000000000000000000000",
      "schema_version": 1,
      "observed_at": "2026-10-25T12:00:00.000Z",
      "cursor": "13",
      "guild_id": "123456789012345670",
      "channel_id": "123456789012345678",
      "type": "message.deleted",
      "data": { "message_id": "123456789012345679", "removed_by": "author" }
    }
  ],
  "cursor": "13",
  "more": false
}
```

Answer with any `2xx`. Each attempt times out after ten seconds.

| Your endpoint's answer                                  | What the relay does               |
| ------------------------------------------------------- | --------------------------------- |
| `2xx`                                                   | Delivered                         |
| Timeout, connection failure, `408`, `429`, or any `5xx` | Retries                           |
| Any other `4xx`, or a redirect                          | Gives up on that delivery         |
| `410`                                                   | Gives up and disables the webhook |

A delivery gets up to 24 attempts, with exponential backoff and jitter. After 50 failed deliveries in a row, or 24 hours
of failures with no success, the relay pauses the webhook until you resume it.

The [subscriptions guide](../../agents/subscriptions.md#verify-before-processing) shows how to verify signatures and
recover a failing receiver.

Sources: [delivery execution](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L239),
[signing](https://github.com/logitland/logitland/blob/main/packages/webhooks/src/index.ts#L1).
