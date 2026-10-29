---
title: Create an application emoji
description: Add an emoji the application owns, by name.
operation:
  method: POST
  path: /api/v10/applications/{app}/emojis
  server: http://127.0.0.1:8790
  parameters:
    - name: app
      in: path
      type: string
      description: The fake application's ID.
      example: '100000000000000001'
    - name: Authorization
      in: header
      required: true
      type: string
      description: The fake bot token.
      example: Bot fake-local
  requestBody:
    schema:
      type: object
      required: [name, image]
      properties:
        name:
          type: string
        image:
          type: string
    example:
      name: standing_now
      image: data:image/png;base64,iVBORw0KGgo…
  responses:
    '200':
      contentType: application/json
      description: The new emoji, with `id`, `name` and the bot as `user`.
    '400':
      description: "A name that isn't 2–32 word characters or is taken, or an image that isn't a PNG, JPEG, GIF, WebP or AVIF data URI (`50035`)."
    '401':
      description: Missing or wrong bot token (`0`).
    '403':
      description: The application ID does not match (`50001`).
source:
  - label: emojis.create
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L362
---

Route name `emojis.create`. The image isn't decoded or size-checked. [`GET`](get-application-emojis.md) lists what was created.

## Errors

- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
