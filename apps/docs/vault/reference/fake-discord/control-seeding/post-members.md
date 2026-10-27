---
title: Add a guild member
description: Add a user as a member of a guild.
operation:
  method: POST
  path: /_fake/members
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - guild
      properties:
        guild:
          type: string
        id:
          type: string
        username:
          type: string
        global_name:
          type: string
        roles:
          type: array
          items:
            type: string
    example:
      guild: '100000000000000010'
      id: '100000000000000030'
      username: alice
  responses:
    '200':
      contentType: application/json
      description: The member ID, username, and roles.
    '400':
      description: Invalid input or an unknown guild or role.
      example:
        error: message
source:
  - label: members
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L162
---

`roles` defaults to `[]`. `username` defaults to `user-` followed by the ID suffix or user count.
