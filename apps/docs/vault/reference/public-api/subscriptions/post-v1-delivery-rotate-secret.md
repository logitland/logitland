---
title: Rotate your webhook secret
description: Replace the webhook signing secret.
operation:
  method: POST
  path: /v1/delivery/rotate-secret
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  responses:
    '200':
      description: The new signing secret, returned once.
      schema:
        $ref: RotatedSecret
      example:
        secret: whsec_new_example
        previous_valid_until: 2026-10-26T12:00:00.000Z
    '404':
      description: No webhook is configured.
    '409':
      description: A concurrent rotation is in progress.
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L77
  - label: rotation
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/webhook.ts#L207
---

The previous secret keeps signing alongside it for 24 hours.
