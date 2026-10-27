---
title: Unsubscribe
description: Unsubscribe.
order: 23
operation:
  protocol: mcp
  kind: tool
  name: unsubscribe
  endpoint: /mcp
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  examples:
    - title: Unsubscribed
      arguments:
        subscription_id: sub_01J00000000000000000000001
      result:
        structuredContent:
          ok: true
  inputSchema:
    type: object
    properties:
      subscription_id:
        type: string
        description: The sub_ ID.
    required:
      - subscription_id
  annotations:
    readOnlyHint: false
    destructiveHint: true
    idempotentHint: false
    openWorldHint: false
source:
  - label: tool
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L153
---

Maps to [DELETE /v1/subscriptions/:id](../../api/subscriptions/delete-v1-subscriptions-id.md).
`subscription_id` is the caller's `sub_` ID string.
This tool is marked destructive.
Missing or foreign subscriptions return `not_found`.
