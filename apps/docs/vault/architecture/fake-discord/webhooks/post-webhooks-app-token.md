---
title: Send an interaction follow-up
description: Add a follow-up message to an acknowledged interaction.
operation:
  method: POST
  path: /api/v10/webhooks/{app}/{token}
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
  requestBody:
    schema:
      type: object
      properties:
        content:
          type: string
          maxLength: 2000
          default: ''
          description: Omitted or null content becomes an empty string.
        flags:
          type: number
          default: 0
    example:
      content: Follow-up
      flags: 64
  responses:
    '200':
      contentType: application/json
      description: The synthetic Message.
    '401':
      description: Unknown or expired interaction token (`50027`).
    '400':
      description: Invalid JSON/body (`50109`), or non-string or overlong content (`50035`).
    '404':
      description: The interaction has not been acknowledged (`10015`).
source:
  - label: followUp
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L236-L242
  - label: token lookup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177-L184
  - label: synthetic Message fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193-L214
---

Use the fake application's ID and a token from [a control interaction](../control-actions/post-interactions.md). The target endpoint must first return a successful HTTP response. No `Authorization` header is needed, and the token expires 15 minutes after the interaction was created.

Messages live in the interaction's `followUps`, not the world's channel message list. See [interaction webhook branches](index.md#interaction-webhook-branches) for shared storage and token rules.

This branch accepts an empty body object and does not apply normal webhook message-body validation. It uses only `content` and numeric `flags`; other fields are ignored. Each successful call appends a new follow-up. Unlike normal webhook execution, it always returns `200` with the synthetic Message, regardless of `wait`.
