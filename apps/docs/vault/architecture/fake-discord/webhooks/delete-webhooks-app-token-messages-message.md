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
      required: true
      type: string
      description: The fake application ID.
      example: '100000000000000001'
    - name: token
      in: path
      required: true
      type: string
      description: The interaction token.
      example: interaction-token
    - name: message
      in: path
      required: true
      type: string
      description: A stored message ID or `@original` for the original-response record.
      example: '@original'
  responses:
    '204':
      description: Message deleted without a response body.
      empty: true
    '401':
      description: Unknown or expired interaction token (`50027`).
    '404':
      description: Unacknowledged interaction (`10015`) or unknown message (`10008`).
source:
  - label: deleteOriginal
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L244-L250
  - label: token lookup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177-L184
  - label: synthetic Message fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193-L214
---

Use the fake application's ID and a token from [a control interaction](../control-actions/post-interactions.md). The target endpoint must first return a successful HTTP response. No `Authorization` header is needed, and the token expires 15 minutes after the interaction was created.

Messages live in the interaction's `followUps`, not the world's channel message list. See [interaction webhook branches](index.md#interaction-webhook-branches) for shared storage and token rules.

`@original` matches only an original record previously created through [`PATCH .../messages/@original`](patch-webhooks-app-token-messages-original.md). Deleting an absent or already-deleted record returns `404/10008`. Deletion does not invalidate the token or remove other messages from the interaction.
