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
---

`name` defaults to `Test server`. IDs and owner otherwise generate. The guild includes owner and bot members, `@everyone`, and the bot role at position 10.
