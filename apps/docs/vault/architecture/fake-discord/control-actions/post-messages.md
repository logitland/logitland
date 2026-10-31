---
title: Create a message
description: Send a message as a user, or create a post in a forum or media channel.
operation:
  method: POST
  path: /_fake/messages
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - channel
        - as
        - content
      properties:
        channel:
          type: string
          description: Existing channel or thread ID.
        as:
          type: string
          description: Existing fake user ID; guild membership is not required.
        content:
          type: string
        reply_to:
          type: string
          description: Non-empty message ID to reference; the referenced message is not looked up.
        type:
          type: number
          description: Defaults to 19 for a reply, otherwise 0.
        thread_name:
          type: string
          description: Required and non-empty for a forum or media post; ignored for other channel types.
        tags:
          type: array
          description: Available tag IDs to apply to a new forum or media post; ignored for other channel types.
          items:
            type: string
    example:
      channel: '100000000000000020'
      as: '100000000000000030'
      content: Hello
  responses:
    '200':
      contentType: application/json
      description: The created Message.
    '400':
      description: Invalid input, an unknown user or channel, a missing forum or media thread name, or an unknown tag.
      example:
        error: message
source:
  - label: messages
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L189-L201
  - label: person message behavior
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L350-L389
  - label: world message mutations
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L490-L524
  - label: World.createForumPost
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L672-L692
---

For a forum or media post, the returned Message's `id` and `channel_id` both identify the new thread.
For other channels and existing threads, the message is added directly to the supplied channel.

This control action skips REST permission and content-length checks. Numeric `type` values can simulate system messages.
