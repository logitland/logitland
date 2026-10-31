---
title: Read a subscription again
description: Re-read a subscription’s events after a cursor (after=, limit 1 to 100), oldest first, without moving its cursor.
order: 25
operation:
  protocol: mcp
  kind: tool
  name: reread_subscription
  endpoint: /mcp
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - messages:read
  examples:
    - title: Subscription events
      arguments:
        subscription_id: sub_01J00000000000000000000001
        after: '12'
        limit: 100
      result:
        structuredContent:
          events: []
          cursor: '12'
          more: false
  inputSchema:
    type: object
    properties:
      subscription_id:
        type: string
        description: The sub_ ID.
      after:
        description: A cursor from a digest or event.
        type: string
      limit:
        type: integer
        minimum: 1
        maximum: 100
    required:
      - subscription_id
  annotations:
    readOnlyHint: true
    destructiveHint: false
    idempotentHint: true
    openWorldHint: false
source:
  - label: tool
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L165
---

Maps to [GET /v1/subscriptions/:id/events](../../api/subscriptions/get-v1-subscriptions-id-events.md).
`subscription_id` is the caller's `sub_` ID.
`after` is an optional decimal cursor of 1–15 digits; it defaults to the stored subscription cursor.
`limit` is 1–100, default 100.
Each call costs one read.
Rereading does not move the subscription cursor.
Results are oldest first. Pass `cursor` as `after` while `more` is true.
