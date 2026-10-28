---
title: Create a webhook
description: Add a webhook to a channel and return its Discord and fake URLs.
operation:
  method: POST
  path: /_fake/webhooks
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - channel
      properties:
        channel:
          type: string
        id:
          type: string
        token:
          type: string
        name:
          type: string
    example:
      channel: '100000000000000020'
      id: '100000000000000050'
      token: local-hook-token
      name: Mirror
  responses:
    '200':
      contentType: application/json
      description: The webhook with its Discord-format url and fakeUrl.
    '400':
      description: Invalid input or an unknown channel.
      example:
        error: message
source:
  - label: webhooks
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L176
  - label: webhook creation result
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L327
---

Missing ID and token generate. Name defaults to `Logitland`. State summaries use the key `fake_url`; webhook creation uses the different key `fakeUrl`.
