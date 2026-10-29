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
          default: Logitland
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
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L185
  - label: webhook creation result
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L344-L348
  - label: webhook defaults
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L308-L321
---

The ID and token generate when omitted. This seeding endpoint requires an existing channel but does not check channel type or bot permissions.

`url` uses Discord's public hostname for relay configuration; `fakeUrl` is the local execution URL. Send test requests to `fakeUrl`, not `url`.
State summaries use the key `fake_url`; webhook creation uses the different key `fakeUrl`. Both URLs contain the webhook token, so keep them in local tests.
