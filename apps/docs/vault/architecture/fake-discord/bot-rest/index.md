---
title: Bot REST
description: Discovery, bot and application identity, guild reads, member roles, and application commands.
order: 1
---

These routes belong to the [local fake](../index.md). Prefix every path with `/api/v10`; `/api/v9` and `/api` also work. Unless noted, routes require `Authorization: Bot fake-local`. The [shared REST errors](../index.md#rest-authentication-and-responses) also apply.

## Discovery and identity

- [GET `/gateway`](get-gateway.md)
- [GET `/gateway/bot`](get-gateway-bot.md)
- [GET `/users/@me`](get-users-me.md)
- [GET `/applications/@me`](get-applications-me.md)

## Guilds and member roles

- [GET `/guilds/:guild/channels`](get-guild-channels.md)
- [GET `/guilds/:guild/roles`](get-guild-roles.md)
- [GET `/guilds/:guild/members/:user`](get-guild-member.md)
- [PUT `/guilds/:guild/members/:user/roles/:role`](put-guild-member-role.md)
- [DELETE `/guilds/:guild/members/:user/roles/:role`](delete-guild-member-role.md)

## Guild application commands

- [GET `/applications/:app/guilds/:guild/commands`](get-guild-commands.md)
- [PUT `/applications/:app/guilds/:guild/commands`](put-guild-commands.md)
