---
title: Execute a webhook
description: Send a message through a webhook.
operation:
  method: POST
  path: /api/v10/webhooks/{id}/{token}
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
    - name: wait
      in: query
      type: string
      description: Return the created Message only when set to the literal `true`.
      example: 'true'
    - name: thread_id
      in: query
      type: string
      description: The target thread ID.
    - name: with_components
      in: query
      type: string
      description: Keep components only when set to the literal `true`.
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
        components:
          type: array
          description: Legacy messages allow up to five action rows; Components V2 allows up to 40 total components, including nested entries.
        flags:
          type: number
          description: Bit 32768 selects Components V2 validation, but webhook execution does not store this flag.
        poll:
          type: object
        allowed_mentions:
          type: object
        tts:
          type: boolean
          default: false
        username:
          type: string
          minLength: 1
          maxLength: 80
        thread_name:
          type: string
          minLength: 1
          maxLength: 100
        applied_tags:
          type: array
          maxItems: 5
          items:
            type: string
    example:
      content: A new idea
      thread_name: Improve onboarding
      applied_tags:
        - '100000000000000070'
      allowed_mentions:
        parse: []
  responses:
    '200':
      contentType: application/json
      description: The created Message when `wait=true`.
    '204':
      description: Message created without a response body when `wait` is not `true`.
      empty: true
    '400':
      description: Empty message (`50006`), invalid fields/thread ID (`50035`), forum/thread rule violation (`220001`, `220002`, `220003`), or unknown forum tag (`10087`).
    '401':
      description: Wrong webhook token (`50027`).
    '404':
      description: Unknown webhook (`10015`), or unknown channel/thread or thread from another parent (`10003`).
source:
  - label: execution fields and forum rules
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L673-L729
  - label: thread target
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L267-L280
  - label: forum creation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L672-L692
---

Handles a webhook route using the token in the path. No Authorization header is required.
When the ID is the fake application ID, this route instead records an interaction follow-up; see [interaction follow-ups](post-webhooks-app-token.md).

Without `with_components=true`, execution validates components but drops them before storage. Reading messages in a thread requires its `thread_id`.

## Execute body

Execution shares [message validation](../messages-threads/post-channel-messages.md#message-body) for `content`, `embeds`, `components`, `poll`, `allowed_mentions`, and `tts`. The same empty-body check accepts a `sticker_ids` array, but stores no stickers. Unlike bot message creation, webhook execution ignores `message_reference`. The example suppresses mention parsing with `allowed_mentions: { parse: [] }`.

`flags: 32768` selects the shared Components V2 layout validation. Unlike bot sends, webhook execution neither rejects
legacy fields beside that flag nor stores the flag. It still stores components only with `with_components=true`.

### Author name

`username` overrides the author name and accepts 1–80 characters. Whitespace-only names fail validation. By default, names containing `clyde` or `discord` also fail, regardless of case. `strictUsernames: false` in the TypeScript startup options disables that reserved-word execution check. `avatar_url` and other unhandled fields have no effect.

### Forum and thread targeting

`thread_name` accepts 1–100 characters. In a forum or media channel, it creates a post. `applied_tags` accepts up to five snowflake strings and applies them to that new post. The fake rejects unknown forum tags with `400/10087`.

Send that body to a webhook on a forum with the example tag, using `?wait=true`. The returned Message's `channel_id` identifies the new thread. The thread and its first message share an ID. The Gateway emits `THREAD_CREATE` before `MESSAGE_CREATE`.

| Condition                                                          | Response     |
| ------------------------------------------------------------------ | ------------ |
| Forum/media webhook with neither `thread_name` nor `thread_id`     | `400/220001` |
| Forum/media webhook with both                                      | `400/220002` |
| `thread_name` on another channel, or nonempty `applied_tags` there | `400/220003` |
| `thread_id` is malformed                                           | `400/50035`  |
| `thread_id` is unknown, not a thread, or belongs to another parent | `404/10003`  |

Posting to an archived target thread unarchives it.

`applied_tags` affects only a newly created post, not an existing `thread_id` target. [Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
