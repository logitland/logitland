---
title: Change a member role
description: Add or remove a role for a guild member.
operation:
  method: POST
  path: /_fake/members/{guild}/{user}/roles/{role}
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: guild
      in: path
      type: string
      description: Digit-only guild ID.
      example: '100000000000000010'
    - name: user
      in: path
      type: string
      description: Digit-only user ID.
      example: '100000000000000030'
    - name: role
      in: path
      type: string
      description: Digit-only role ID.
      example: '100000000000000040'
  requestBody:
    schema:
      type: object
      properties:
        remove:
          type: boolean
          default: false
          description: Only true removes the role; every other value adds it.
    example:
      remove: false
  responses:
    '200':
      description: The requested role state is in place.
      example:
        ok: true
    '400':
      description: Invalid input or an unknown guild, member, or role.
      example:
        error: message
source:
  - label: member role change
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L257-L264
  - label: World.setMemberRole
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L378-L401
---

If the member already has the requested role state, the request succeeds without emitting an event.
Otherwise, the change emits `GUILD_MEMBER_UPDATE`.
