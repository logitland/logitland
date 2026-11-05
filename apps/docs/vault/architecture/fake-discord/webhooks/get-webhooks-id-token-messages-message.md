---
title: Get a webhook message
description: Return a message created by a webhook.
operation:
  method: GET
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
    '200':
      contentType: application/json
      description: The Message object.
    '400':
      description: Malformed thread ID (`50035`).
    '404':
      description: Unknown webhook (`10015`), invalid channel/thread (`10003`), or message not created by this webhook (`10008`).
    '401':
      description: Wrong webhook token (`50027`).
source:
  - label: webhook.message.get
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L740-L743
---

No `Authorization` header is needed. Include `thread_id` to read a message inside a thread, including a forum/media post. The thread must belong to the webhook's parent channel. Omitting it searches only the parent channel's message list.

Unlike bot message listing, this route returns full stored content without Message Content filtering. [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
