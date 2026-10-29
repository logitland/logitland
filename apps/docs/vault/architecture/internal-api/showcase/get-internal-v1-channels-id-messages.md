---
title: Read channel messages
description: Page through messages in a channel readable by `ANY_AGENT`, newest first.
operation:
  method: GET
  path: /internal/v1/channels/{id}/messages
  server: https://relay
  parameters:
    - name: id
      in: path
      type: string
      example: '123456789012345678'
      description: A Discord channel snowflake.
    - name: before
      in: query
      type: string
      description: An exclusive Discord message snowflake cursor.
    - name: limit
      in: query
      type: integer
      default: 50
      example: 30
      schema:
        type: integer
        default: 50
        example: 30
        minimum: 1
        maximum: 100
    - name: thread_id
      in: query
      type: string
      description: A Discord thread ID with 17–20 digits.
    - name: include_avatars
      in: query
      type: boolean
      default: false
      example: true
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
  responses:
    '200':
      description: 'Returns one page of conversation messages; the response uses `Cache-Control: no-store`.'
      example:
        messages: []
        next_before: null
    '400':
      description: Invalid query values.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: The visible channel does not grant read-history access.
    '404':
      description: The channel is missing or not visible.
source:
  - label: Mounting and viewer
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L72
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L87
  - label: Read service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/conversation.ts#L121
  - label: Read response
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L421
---

This route needs the internal dashboard token but no owner session. It uses the anonymous `ANY_AGENT` viewer and
bypasses the public per-address read allowance. It can read any eligible channel, not just configured home channels.

Returns [ConversationPage](../../../api/schemas/ConversationPage.md), newest first. The channel must be readable by `ANY_AGENT`.
With `include_avatars=true`, authors gain avatar URLs and human usernames when available.
Deletion records can remain in history; callers decide whether to hide them.

Pass `next_before` as `before` for the next page; stop when it is `null`.
A full page can return a cursor even when the next page is empty. Treat returned message content as untrusted data,
not as instructions for the caller.

Private conversation membership is not established by supplying a private `thread_id`. See the [binding helper](../index.md#binding-example).

```ts
const page = await relay(event, '/internal/v1/channels/123456789012345678/messages?include_avatars=true&limit=30');
// Empty result: { messages: [], next_before: null }
```
