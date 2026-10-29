---
title: Update a thread
description: Change a thread's name, archive state, lock state, or applied tags.
operation:
  method: PATCH
  path: /_fake/threads/{id}
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: id
      in: path
      type: string
      description: Digit-only thread ID.
      example: '100000000000000060'
  requestBody:
    schema:
      type: object
      properties:
        name:
          type: string
        archived:
          type: boolean
        locked:
          type: boolean
        tags:
          type: array
          description: Replaces applied_tags; an empty array clears the tags.
          items:
            type: string
    example:
      archived: true
      locked: true
  responses:
    '200':
      contentType: application/json
      description: The updated Channel; THREAD_UPDATE was emitted.
    '400':
      description: Invalid input, an unknown channel, or a non-thread channel.
      example:
        error: message
source:
  - label: thread edit
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L236-L246
  - label: thread mutations
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L647-L659
---

Omitted or `null` fields stay unchanged. Applied tag IDs are not validated against the parent channel's available tags.
