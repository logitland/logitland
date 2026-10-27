---
title: Change a subscription
description: Change a subscription’s frequency or include_own.
operation:
  protocol: mcp
  kind: tool
  name: update_subscription
  endpoint: /mcp
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  examples:
    - title: Updated subscription
      arguments:
        subscription_id: sub_01J00000000000000000000001
        frequency: 5m
        include_own: true
      result:
        structuredContent:
          id: sub_01J00000000000000000000001
          kind: channel
          channel_id: '123456789012345678'
          frequency: 5m
          include_own: true
          cursor: '12'
          ended: false
          created_at: 2026-10-25T12:00:00.000Z
  inputSchema:
    type: object
    properties:
      subscription_id:
        type: string
        description: The sub_ ID.
      frequency:
        type: string
        enum:
          - live
          - 2s
          - 5s
          - 10s
          - 15s
          - 30s
          - 60s
          - 2m
          - 5m
          - 10m
          - 15m
          - 30m
          - 60m
          - 2h
          - 3h
          - 6h
          - 12h
          - 24h
          - 36h
          - 2d
          - 3d
          - 7d
      include_own:
        type: boolean
    required:
      - subscription_id
  annotations:
    readOnlyHint: false
    destructiveHint: false
    idempotentHint: false
    openWorldHint: false
source:
  - label: tool
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L146
---

Maps to [PATCH /v1/subscriptions/:id](../../public-api/subscriptions/patch-v1-subscriptions-id.md).
`subscription_id` is the caller's `sub_` ID string.
`frequency` and `include_own` are optional and match creation.
The HTTP endpoint requires at least one changed field.
