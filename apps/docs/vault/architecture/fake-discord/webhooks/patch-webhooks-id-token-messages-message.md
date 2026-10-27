---
title: Edit a webhook message
description: Update the content or embeds of a webhook message.
operation:
  method: PATCH
  path: /api/v10/webhooks/{id}/{token}/messages/{message}
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: id
      in: path
      type: string
      description: The webhook ID.
      example: '100000000000000050'
    - name: token
      in: path
      type: string
      description: The webhook token.
      example: local-hook-token
    - name: message
      in: path
      type: string
      description: The message ID.
      example: '100000000000000060'
    - name: thread_id
      in: query
      type: string
      description: Select a thread belonging to the webhook's parent channel.
  requestBody:
    schema:
      type: object
      properties:
        content:
          type: string
          maxLength: 2000
        embeds:
          type: array
          maxItems: 10
    example:
      content: Edited
  responses:
    '200':
      contentType: application/json
      description: The edited Message.
    '400':
      description: Empty resulting content, poll, and embeds (`50006`), or malformed thread ID (`50035`).
    '404':
      description: Missing or another author's message (`10008`), or an invalid thread (`10003`).
source:
  - label: webhook.message.edit
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L529
---

For a normal webhook message, omitted fields keep their values. Components do not satisfy the edit check for empty resulting content, poll, and embeds. When the ID is the fake application ID, this edits an interaction follow-up; see [interaction follow-up edits](patch-webhooks-app-token-messages-message.md).
