---
title: Edit an interaction follow-up
description: Update the content of an interaction follow-up message.
operation:
  method: PATCH
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
      description: A message ID stored on this interaction, including the original response's ID.
      example: '100000000000000060'
  requestBody:
    schema:
      type: object
      properties:
        content:
          type: string
          maxLength: 2000
          default: ''
          description: Omitted or null content becomes an empty string.
    example:
      content: Updated follow-up
  responses:
    '200':
      contentType: application/json
      description: The edited Message.
    '401':
      description: Unknown or expired interaction token (`50027`).
    '400':
      description: Invalid JSON/body (`50109`), or non-string or overlong content (`50035`).
    '404':
      description: Unacknowledged interaction (`10015`) or unknown stored message (`10008`).
source:
  - label: follow-up edit branch
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L216-L234
  - label: token lookup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177-L184
  - label: synthetic Message fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193-L214
---

Use the fake application's ID and a token from [a control interaction](../control-actions/post-interactions.md). The target endpoint must first return a successful HTTP response. No `Authorization` header is needed, and the token expires 15 minutes after the interaction was created.

Messages live in the interaction's `followUps`, not the world's channel message list. See [interaction webhook branches](index.md#interaction-webhook-branches) for shared storage and token rules.

Omitted or `null` content becomes empty, and an empty body object is valid. Editing by message ID preserves flags and ignores all other fields. Synthetic responses keep `edited_timestamp: null`.

This route can also edit a stored original message by its ID. Use [`@original`](patch-webhooks-app-token-messages-original.md) to create the original record or change its flags.
