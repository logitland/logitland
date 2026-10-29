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
      required: true
      type: string
      description: The webhook ID.
      example: '100000000000000050'
    - name: token
      in: path
      required: true
      type: string
      description: The webhook token.
      example: local-hook-token
    - name: message
      in: path
      required: true
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
      description: Unknown webhook (`10015`), invalid channel/thread (`10003`), or message not created by this webhook (`10008`).
    '401':
      description: Wrong webhook token (`50027`).
source:
  - label: webhook.message.delete
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L619-L625
---

No `Authorization` header is needed. A normal webhook can delete only its own messages. Include `thread_id` for a message in a thread, including a forum/media post; the thread must belong to the webhook's parent channel. Omitting it searches only the parent channel. A second delete returns `404/10008`.

When the ID is the fake application ID, this instead deletes an interaction follow-up or original message; see [interaction message deletion](delete-webhooks-app-token-messages-message.md).

[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
