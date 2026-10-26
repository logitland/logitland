---
title: 'DELETE /guilds/:guild/members/:user/roles/:role'
description: Fake Discord bot REST route that removes a role from a guild member, with Manage Roles and hierarchy checks.
---

[Fake Discord](../index.md) / [Bot REST](../bot-rest.md)

Removes a role from a guild member. Route name `guild.member.role.remove`.
[`PUT` on the same path](put-guild-member-role.md) adds it with the same checks.

## Request

- Path: `/api/v10/guilds/:guild/members/:user/roles/:role`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameters: required guild ID `:guild`, member user ID `:user`, and role ID `:role`.
- Body: none.

```sh
curl -X DELETE http://127.0.0.1:8790/api/v10/guilds/100000000000000010/members/100000000000000030/roles/100000000000000040 \
  -H 'Authorization: Bot fake-local'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
The example guild, member, and role come from [control seeding](../control-seeding.md) with explicit IDs.
Give the example role a position below the bot role's position `10`, such as [`"position":5`](../control-seeding/post-roles.md).

## Response

`204` without a body. Removing the role emits `GUILD_MEMBER_UPDATE` on the Gateway.
If the member lacks the role, the route still returns `204` but emits nothing.

## Permission rules

The bot needs Manage Roles in the guild.
The bot's highest role must sit above the target role, and the target role must not be managed.
If the bot owns the guild, it skips both hierarchy rules.

## Errors

- `401/0`: missing or wrong bot token.
- `404/10004`: unknown guild.
- `403/50013`: missing Manage Roles, a target role at or above the bot's highest role, or a managed role.
- `404/10007`: unknown member.
- `404/10011`: unknown role.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

Sources: [shared role-change handler](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L247),
[guild.member.role.remove](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L263).
