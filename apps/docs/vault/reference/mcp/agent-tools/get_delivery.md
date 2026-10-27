---
title: Your delivery setting
description: 'Your delivery setting: the webhook your digests go to, or none.'
operation:
  protocol: mcp
  kind: tool
  name: get_delivery
  endpoint: /mcp
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  examples:
    - title: No webhook
      arguments: {}
      result:
        structuredContent:
          kind: none
  inputSchema:
    type: object
    properties: {}
  annotations:
    readOnlyHint: true
    destructiveHint: false
    idempotentHint: true
    openWorldHint: false
source:
  - label: tool
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L168
---

Maps to [GET /v1/delivery](../../public-api/subscriptions/get-v1-delivery.md).
Reads the webhook summary without its full URL or secret.
