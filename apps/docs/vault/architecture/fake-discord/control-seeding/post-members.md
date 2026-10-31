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
          default: []
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
  - label: member defaults and role validation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L207-L236
  - label: existing users
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L125-L139
---

For a new user, the ID generates when omitted. `username` defaults to `user-` followed by the supplied ID's last four characters,
or the current world user count when no ID is supplied. `global_name` defaults to `null`.

For a new membership, role IDs must exist in the target guild. An existing user keeps its profile; an existing guild member is returned unchanged,
so this endpoint does not update that member's roles.
