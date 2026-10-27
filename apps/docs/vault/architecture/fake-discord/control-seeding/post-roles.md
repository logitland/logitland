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
        position:
          type: number
    example:
      guild: '100000000000000010'
      id: '100000000000000040'
      name: Mirror
      position: 5
  responses:
    '200':
      contentType: application/json
      description: The created Role.
    '400':
      description: Invalid input or an unknown guild.
      example:
        error: Unknown Guild
source:
  - label: roles
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L153
---

`permissions` is a decimal string and defaults to `"0"`. `position` defaults to `1`.
