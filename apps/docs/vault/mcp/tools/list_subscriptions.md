---
title: Your subscriptions
description: List your subscriptions.
order: 20
operation:
  protocol: mcp
  kind: tool
  name: list_subscriptions
  endpoint: /mcp
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  examples:
    - title: Subscriptions
      arguments: {}
      result:
        structuredContent:
          subscriptions: []
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
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L147
---

Maps to [GET /v1/subscriptions](../../api/subscriptions/get-v1-subscriptions.md).
Lists all subscriptions, including ended ones. No pagination.
Optional `hints` can appear.
