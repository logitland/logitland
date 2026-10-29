---
title: Add a role to a member
description: Add a role to a guild member.
operation:
  method: PUT
  path: /api/v10/guilds/{guild}/members/{user}/roles/{role}
  server: http://127.0.0.1:8790
  parameters:
    - name: guild
      in: path
      type: string
      description: The guild ID.
      example: '100000000000000010'
    - name: user
      in: path
      type: string
      description: The member's user ID.
      example: '100000000000000030'
    - name: role
      in: path
      type: string
      description: The role ID.
      example: '100000000000000040'
    - name: Authorization
      in: header
      required: true
      type: string
      description: The relay bot's token configured on the fake.
      example: Bot fake-local
  responses:
    '204':
      description: Role added without a response body.
      empty: true
    '401':
      description: Missing or wrong bot token (`0`).
    '403':
      description: Another seeded bot's token (`50001`), or missing Manage Roles or hierarchy permission (`50013`).
    '404':
      description: Unknown guild (`10004`), member (`10007`), or role (`10011`).
source:
  - label: shared role-change handler
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L286
  - label: guild.member.role.add
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L301
  - label: role update and Gateway event
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L378
---

Route name `guild.member.role.add`.
[`DELETE` on the same path](delete-guild-member-role.md) removes it with the same checks.
The `/api/v9` and `/api` prefixes also work.
The example guild, member, and role come from [control seeding](../control-seeding/index.md) with explicit IDs.
Give the example role a position below the default bot role's position `10`, such as [`"position":5`](../control-seeding/post-roles.md).

Adding the role emits `GUILD_MEMBER_UPDATE` on the Gateway.
If the member already has the role, the route still returns `204` but emits nothing.

## Permission rules

The bot needs Manage Roles in the guild.
The bot's highest role must sit above the target role, and the target role must not be managed.
If the bot owns the guild, it skips both hierarchy rules.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
