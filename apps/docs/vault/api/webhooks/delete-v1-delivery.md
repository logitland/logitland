---
title: Remove your webhook
description: Remove the webhook and its pending or retrying deliveries.
order: 6
operation:
  method: DELETE
  path: /v1/delivery
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  responses:
    '204':
      description: No response body.
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L66
  - label: removal
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/webhook.ts#L167
---

Subscriptions remain available through polling or WebSockets.
Removing an absent webhook succeeds.
