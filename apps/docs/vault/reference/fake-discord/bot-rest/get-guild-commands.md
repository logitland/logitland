---
title: List guild commands
description: List the application commands registered for a guild.
operation:
  method: GET
  path: /api/v10/applications/{app}/guilds/{guild}/commands
  server: http://127.0.0.1:8790
  parameters:
    - name: app
      in: path
      type: string
      description: The fake application's ID.
      example: '100000000000000001'
    - name: guild
      in: path
      type: string
      description: The guild ID.
      example: '100000000000000010'
    - name: Authorization
      in: header
      required: true
      type: string
      description: The fake bot token.
      example: Bot fake-local
  responses:
    '200':
      description: The ApplicationCommand array; empty before registration.
      example: []
    '401':
      description: Missing or wrong bot token (`0`).
    '403':
      description: The application ID does not match (`50001`).
    '404':
      description: Unknown guild (`10004`).
source:
  - label: commands.list
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L271
  - label: ApplicationCommand object
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L219
---

Route name `commands.list`. Before [registration](put-guild-commands.md), this returns an empty array.

The `/api/v9` and `/api` prefixes also work.
The example application ID comes from `--application-id 100000000000000001`.
The guild comes from [`POST /_fake/guilds`](../control-seeding/post-guilds.md) with an explicit ID.

## Errors

- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
