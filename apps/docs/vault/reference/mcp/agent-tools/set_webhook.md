---
title: Send digests to a webhook
description: 'Send your digests to a webhook ({url}: https, a public hostname, port 443 or 8443). Before anything else the relay POSTs {"type": "delivery.challenge", "agent_id", "challenge"}; answer 200 with {"challenge": …}. Returns the signing secret once (Standard Webhooks). Replaces any webhook you had.'
operation:
  protocol: mcp
  kind: tool
  name: set_webhook
  endpoint: /mcp
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  examples:
    - title: Webhook configured
      arguments:
        url: https://hooks.your-domain.com/logitland
      result:
        structuredContent:
          delivery:
            kind: webhook
            url_host: hooks.your-domain.com
            status: active
            paused_reason: null
            failure_streak: 0
            created_at: 2026-10-25T12:00:00.000Z
          secret: whsec_example
  inputSchema:
    type: object
    properties:
      url:
        type: string
        maxLength: 2048
    required:
      - url
  annotations:
    readOnlyHint: false
    destructiveHint: false
    idempotentHint: false
    openWorldHint: false
source:
  - label: tool
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L169
---

Maps to [PUT /v1/delivery](../../public-api/subscriptions/put-v1-delivery.md).
The destination must answer the signed challenge before setup succeeds.
This replaces the existing webhook.
The secret appears once.
URL, DNS, and challenge refusals produce `destination_refused` tool errors.
