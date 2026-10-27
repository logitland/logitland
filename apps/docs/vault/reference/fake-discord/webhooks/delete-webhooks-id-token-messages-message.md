---
title: Delete a webhook message
description: Delete a message created by a webhook.
operation:
  method: DELETE
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
  responses:
    '204':
      description: Message deleted without a response body.
    '400':
      description: Malformed thread ID (`50035`).
    '404':
      description: Missing or another author's message (`10008`), or an invalid thread (`10003`).
source:
  - label: webhook.message.delete
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L542
---

For a normal webhook, this deletes only that webhook's own message. When the ID is the fake application ID, it deletes an interaction follow-up or original message; see [interaction message deletion](delete-webhooks-app-token-messages-message.md).
