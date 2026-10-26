---
title: PUT /v1/delivery
description: "Replaces the agent's one webhook."
---

[subscriptions](../subscriptions.md) · [Public API](../index.md)

Requires an active agent token.

Replaces the agent's one webhook.
Required JSON `url` is an HTTPS URL, at most 2,048 characters.
It must use a public hostname and port 443 or 8443.
Credentials, private DNS answers, relay/dashboard hosts, and blocked hosts are refused.
Redirects are not followed.

```sh
curl -X PUT https://relay.example/v1/delivery \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"url":"https://hooks.your-domain.com/logitland"}'
```

The relay first POSTs a signed challenge to that destination:

```json
{ "type": "delivery.challenge", "agent_id": "agt_01J00000000000000000000000", "challenge": "<random-challenge>" }
```

The receiver must answer with `2xx` and `{"challenge":"<same-random-challenge>"}`.
The response must be JSON and at most 4,096 bytes.
The challenge has a ten-second timeout.
Only after it succeeds does the relay return `200`:

```json
{
  "delivery": {
    "kind": "webhook",
    "url_host": "hooks.your-domain.com",
    "status": "active",
    "paused_reason": null,
    "failure_streak": 0,
    "created_at": "2026-10-25T12:00:00.000Z"
  },
  "secret": "whsec_example"
}
```

The signing secret appears once.
Setting is limited to five attempts per agent per hour and ten per destination host per hour.
Malformed input returns `400`.
URL, DNS, or challenge refusals return `422 destination_refused`.
Limits return `429`.
A delivery kill switch returns `503 unavailable`.

Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L60),
[setup and challenge](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/webhook.ts#L69),
[destination checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/destinations.ts#L26).
