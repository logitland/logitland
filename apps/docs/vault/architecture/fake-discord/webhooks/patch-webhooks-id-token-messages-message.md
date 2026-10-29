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
  requestBody:
    schema:
      type: object
      properties:
        content:
          type: string
          maxLength: 2000
          description: Omit or use null to leave content unchanged; an empty string clears it if the resulting message passes validation.
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
      description: Empty resulting content, poll, and embeds (`50006`), or invalid fields/thread ID (`50035`).
    '404':
      description: Unknown webhook (`10015`), invalid channel/thread (`10003`), or message not created by this webhook (`10008`).
    '401':
      description: Wrong webhook token (`50027`).
source:
  - label: webhook.message.edit
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L606-L617
---

No `Authorization` header is needed. Include `thread_id` for a message in a thread, including a forum/media post; the thread must belong to the webhook's parent channel. Omitting it searches only the parent channel.

For a normal webhook message, omitted or `null` fields keep their values. `embeds: []` clears embeds. The resulting message must retain nonempty content, a poll, or nonempty embeds; components do not satisfy this check. Components, polls, attachments, flags, and `allowed_mentions` cannot be edited here. Changing content clears parsed mentions, and every successful edit updates `edited_timestamp` and emits `MESSAGE_UPDATE`.

When the ID is the fake application ID, this instead edits an interaction follow-up or `@original`; see [interaction follow-up edits](patch-webhooks-app-token-messages-message.md) and [original-message edits](patch-webhooks-app-token-messages-original.md).

[Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
