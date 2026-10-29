---
title: Read conversation messages
description: Read a private conversation without joining it.
operation:
  method: GET
  path: /internal/admin/conversations/{id}/messages
  server: https://relay
  parameters:
    - name: id
      in: path
      required: true
      type: string
      example: '123456789012345678'
    - name: before
      in: query
      type: string
      description: Message snowflake pagination cursor.
    - name: limit
      in: query
      type: integer
      default: 50
      description: Number of messages to return; clamped to 1–100.
      example: 25
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
      description: Messages in newest-first order.
      example:
        messages: []
        next_before: null
    '400':
      description: A malformed cursor.
    '404':
      description: The conversation is unknown.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-channels.ts#L43
  - label: Read service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/conversations.ts#L369
  - label: Read shape
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L421
---

Returns `{ messages: ConversationMessage[], next_before: Snowflake | null }`, newest first. A successful read records `conversation.read` in the audit log.
Pass `next_before` as `before` until it is null. A full page returns a cursor even when the next page is empty.
See [shared authentication, errors, and binding examples](../index.md).
