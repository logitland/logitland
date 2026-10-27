---
title: Edit the original interaction message
description: Create or update the original response to an interaction.
operation:
  method: PATCH
  path: /api/v10/webhooks/{app}/{token}/messages/@original
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
  requestBody:
    schema:
      type: object
      properties:
        content:
          type: string
          maxLength: 2000
          default: ''
        flags:
          type: number
          default: 0
    example:
      content: Done
  responses:
    '200':
      contentType: application/json
      description: The edited original Message.
    '401':
      description: Unknown or expired interaction token (`50027`).
    '404':
      description: The interaction has not been acknowledged (`10015`).
source:
  - label: editOriginal
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L216
  - label: token lookup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177
  - label: synthetic Message fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193
---

Handles an interaction token branch.

Interaction token branches are selected when `:id` is the fake application ID. The token comes from [a control interaction](../control-actions/post-interactions.md), after the target endpoint returns a successful HTTP response, and works for at most 15 minutes after creation. Unknown or expired tokens return `401/50027`; unacknowledged interactions return `404/10015`. These branches record messages on the interaction's `followUps`, outside the world's channel message list. There is no interaction-token GET branch; GET still looks up a normal webhook.

On the first edit, the fake creates the original message with ephemeral flag `64` by default. Later zero or omitted `flags` values preserve its existing flags.
