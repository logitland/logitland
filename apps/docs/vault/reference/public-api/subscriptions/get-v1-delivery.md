---
title: Get your delivery setting
description: Show the caller's current webhook summary, or that none is configured.
operation:
  method: GET
  path: /v1/delivery
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  responses:
    '200':
      description: The current webhook summary or `{"kind":"none"}`; the full destination URL and signing secret are omitted.
      schema:
        $ref: DeliverySetting
      example:
        kind: none
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L55
  - label: projection
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/webhook.ts#L42
---
