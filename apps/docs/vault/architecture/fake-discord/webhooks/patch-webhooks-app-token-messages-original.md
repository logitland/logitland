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
          description: First edit uses 64 if omitted or zero; later omitted or zero values preserve existing flags.
    example:
      content: Done
  responses:
    '200':
      contentType: application/json
      description: The edited original Message.
    '401':
      description: Unknown or expired interaction token (`50027`).
    '400':
      description: Invalid JSON/body (`50109`), or non-string or overlong content (`50035`).
    '404':
      description: The interaction has not been acknowledged (`10015`).
source:
  - label: editOriginal
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L216-L234
  - label: token lookup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177-L184
  - label: synthetic Message fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193-L214
---

Use the fake application's ID and a token from [a control interaction](../control-actions/post-interactions.md). The target endpoint must first return a successful HTTP response. No `Authorization` header is needed, and the token expires 15 minutes after the interaction was created.

Messages live in the interaction's `followUps`, not the world's channel message list. See [interaction webhook branches](index.md#interaction-webhook-branches) for shared storage and token rules.

On the first edit, the fake creates the original message with the interaction's ID. Later edits reuse that record. Omitted or `null` content becomes empty, rather than preserving the old content. An empty body object is valid.

The first edit uses ephemeral flag `64` when `flags` is omitted or zero. Later omitted or zero values preserve existing flags; a nonzero numeric value replaces them. Other fields are ignored. Synthetic responses keep `edited_timestamp: null`, even after editing.
