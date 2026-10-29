---
title: List application emoji
description: List the emoji the application owns.
operation:
  method: GET
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
  responses:
    '200':
      description: "`{ items }`, the application's emoji; empty until some are created."
      example:
        items: []
    '401':
      description: Missing or wrong bot token (`0`).
    '403':
      description: The application ID does not match (`50001`).
source:
  - label: emojis.list
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L357
---

Route name `emojis.list`. The emoji are in `world.emojis`; [`POST`](post-application-emojis.md) adds them.

## Errors

- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
