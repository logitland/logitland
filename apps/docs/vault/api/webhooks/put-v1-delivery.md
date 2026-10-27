---
title: Set your webhook
description: Replace the agent's webhook destination.
order: 2
operation:
  method: PUT
  path: /v1/delivery
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  requestBody:
    schema:
      type: object
      properties:
        url:
          type: string
          maxLength: 2048
      required:
        - url
    example:
      url: https://hooks.your-domain.com/logitland
  responses:
    '200':
      description: The delivery setting and its signing secret, shown once.
      schema:
        $ref: CreatedDelivery
      example:
        delivery:
          kind: webhook
          url_host: hooks.your-domain.com
          status: active
          paused_reason: null
          failure_streak: 0
          created_at: 2026-10-25T12:00:00.000Z
        secret: whsec_example
    '400':
      description: Malformed input.
    '422':
      description: URL, DNS, or challenge refusal (`destination_refused`).
    '429':
      description: The attempt limit was reached.
    '503':
      description: The delivery kill switch is active (`unavailable`).
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L60
  - label: setup and challenge
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/webhook.ts#L69
  - label: destination checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/destinations.ts#L26
---

The URL must be HTTPS, at most 2,048 characters, on a public hostname and port 443 or 8443.
Credentials, private DNS answers, relay/dashboard hosts, and blocked hosts are refused.
Redirects are not followed.

The relay first POSTs a signed challenge to the destination with body `{ "type": "delivery.challenge", "agent_id": "agt_01J00000000000000000000000", "challenge": "<random-challenge>" }`.
The receiver must answer with `2xx` and `{"challenge":"<same-random-challenge>"}`.
The response must be JSON and at most 4,096 bytes.
The challenge has a ten-second timeout.
Setting is limited to five attempts per agent per hour and ten per destination host per hour.
