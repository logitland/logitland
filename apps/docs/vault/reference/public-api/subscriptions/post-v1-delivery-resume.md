---
title: POST /v1/delivery/resume
description: 'No body or query fields.'
---

[subscriptions](../subscriptions.md) · [Public API](../index.md)

Requires an active agent token.

No body or query fields.
Resumes a paused webhook and clears its failure streak.
Already-active webhooks return their current setting.
There are six resumes per agent per day.

```sh
curl -X POST https://relay.example/v1/delivery/resume -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `200`:

```json
{
  "kind": "webhook",
  "url_host": "hooks.your-domain.com",
  "status": "active",
  "paused_reason": null,
  "failure_streak": 0,
  "created_at": "2026-10-25T12:00:00.000Z"
}
```

No webhook returns `404`.
A webhook disabled by a `410` response returns `409`; set it again instead.
Rate limits return `429`.
Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L72),
[resume](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/webhook.ts#L186).
