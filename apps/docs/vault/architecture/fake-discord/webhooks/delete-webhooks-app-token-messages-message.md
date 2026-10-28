---
title: Delete an interaction message
description: Delete an original or follow-up interaction message.
operation:
  method: DELETE
  path: /api/v10/webhooks/{app}/{token}/messages/{message}
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: app
      in: path
      type: string
      description: The fake application ID.
      example: '100000000000000001'
    - name: token
      in: path
      type: string
      description: The interaction token.
      example: interaction-token
    - name: message
      in: path
      type: string
      description: A follow-up message ID or `@original`.
      example: '@original'
  responses:
    '204':
      description: Message deleted without a response body.
    '401':
      description: Unknown or expired interaction token (`50027`).
    '404':
      description: Unacknowledged interaction (`10015`) or unknown message (`10008`).
source:
  - label: deleteOriginal
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L244
  - label: token lookup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177
  - label: synthetic Message fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193
---

Handles an interaction token branch.

Interaction token branches are selected when `:id` is the fake application ID. The token comes from [a control interaction](../control-actions/post-interactions.md), after the target endpoint returns a successful HTTP response, and works for at most 15 minutes after creation. Unknown or expired tokens return `401/50027`; unacknowledged interactions return `404/10015`. These branches record messages on the interaction's `followUps`, outside the world's channel message list. There is no interaction-token GET branch; GET still looks up a normal webhook.
