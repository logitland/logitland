---
title: Create a guild
description: Add a guild to the fake Discord world.
operation:
  method: POST
  path: /_fake/guilds
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
          default: Test server
        owner_id:
          type: string
    example:
      id: '100000000000000010'
      name: Test server
  responses:
    '200':
      contentType: application/json
      description: The guild ID, name, everyone role ID, bot role ID, and owner ID.
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: guilds
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L121
  - label: guild creation and default members
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L138-L159
---

The guild ID and owner ID generate when omitted. A supplied `owner_id` reuses that user or creates one if needed.
The guild includes the owner and relay bot as members, an `@everyone` role, and the bot role at position `10`.
The `@everyone` role ID equals the guild ID; the bot role ID generates.
