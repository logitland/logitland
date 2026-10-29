---
title: Create a role
description: Add a role to a guild.
operation:
  method: POST
  path: /_fake/roles
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - guild
        - name
      properties:
        guild:
          type: string
        id:
          type: string
        name:
          type: string
        permissions:
          type: string
          default: '0'
          description: Permissions as a decimal bitfield string.
        position:
          type: number
          default: 1
    example:
      guild: '100000000000000010'
      id: '100000000000000040'
      name: Mirror
      position: 5
  responses:
    '200':
      contentType: application/json
      description: The created role object, with permissions serialized as a decimal string.
    '400':
      description: Invalid input, an invalid permissions bitfield, or an unknown guild.
      example:
        error: Unknown Guild
source:
  - label: roles
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L153
  - label: role creation and defaults
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L168-L196
---

The role ID generates when omitted. This seeding endpoint does not enforce the bot's role hierarchy or validate position bounds.
