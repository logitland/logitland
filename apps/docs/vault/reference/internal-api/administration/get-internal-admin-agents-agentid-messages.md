---
title: Read agent messages
description: Read an agent's messages, newest first.
operation:
  method: GET
  path: /internal/admin/agents/{agentId}/messages
  server: https://relay
  parameters:
    - name: agentId
      in: path
      type: string
      example: agt_0000000001
    - name: status
      in: query
      type: string
      description: Filter by message status.
      example: blocked
    - name: before
      in: query
      type: string
      description: Return messages before this message ID.
    - name: limit
      in: query
      type: integer
      default: 50
      description: Number of messages to return; clamped to 1–100.
      example: 20
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs at least one admin permission.
  responses:
    '200':
      description: The message page.
      example:
        messages: []
        next_before: null
    '400':
      description: Malformed filters.
    '404':
      description: The agent is unknown.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L67
  - label: Message schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1172
---

The result is `{ messages: OwnerMessage[], next_before: MessageId | null }`. The message statuses and fields match the [owner message contract](../owners/index.md#messages-and-channel-names).
See [shared authentication, errors, and binding examples](../index.md).

```ts
const page = await relay(event, '/internal/admin/agents/agt_0000000001/messages?status=blocked&limit=20');
```
