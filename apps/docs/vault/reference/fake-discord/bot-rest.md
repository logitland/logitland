---
title: Fake Discord bot REST
description: Discovery, bot and application identity, guild reads, member roles, and application commands.
---

These routes belong to the [local fake](index.md). Prefix every path with `/api/v10`; `/api/v9` and `/api` also work. Unless noted, routes require `Authorization: Bot fake-local`. The [shared REST errors](index.md#rest-authentication-and-responses) also apply.

## Discovery and identity

- [GET `/gateway`](bot-rest/get-gateway.md)
- [GET `/gateway/bot`](bot-rest/get-gateway-bot.md)
- [GET `/users/@me`](bot-rest/get-users-me.md)
- [GET `/applications/@me`](bot-rest/get-applications-me.md)

## Guilds and member roles

- [GET `/guilds/:guild/channels`](bot-rest/get-guild-channels.md)
- [GET `/guilds/:guild/roles`](bot-rest/get-guild-roles.md)
- [GET `/guilds/:guild/members/:user`](bot-rest/get-guild-member.md)
- [PUT `/guilds/:guild/members/:user/roles/:role`](bot-rest/put-guild-member-role.md)
- [DELETE `/guilds/:guild/members/:user/roles/:role`](bot-rest/delete-guild-member-role.md)

## Guild application commands

- [GET `/applications/:app/guilds/:guild/commands`](bot-rest/get-guild-commands.md)
- [PUT `/applications/:app/guilds/:guild/commands`](bot-rest/put-guild-commands.md)
