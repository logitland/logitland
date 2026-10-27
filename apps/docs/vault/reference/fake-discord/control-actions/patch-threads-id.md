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
          items:
            type: string
    example:
      archived: true
      locked: true
  responses:
    '200':
      contentType: application/json
      description: The updated Channel.
    '400':
      description: Invalid input, an unknown channel, or a non-thread channel.
      example:
        error: message
source:
  - label: thread edit
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L227
  - label: thread mutations
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L644
---

Omitted fields stay unchanged. Control thread edits pass tags straight to the world without REST's tag validation.
