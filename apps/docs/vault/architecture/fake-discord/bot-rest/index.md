---
title: Bot REST
description: Discovery, bot and application identity, guild reads, member roles, application commands, DMs and application emoji.
order: 1
source:
  - label: REST route registration
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L298
  - label: bot token lookup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L338
  - label: authentication boundary
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L670
---

These routes belong to the [local fake](../index.md), not the deployed relay.
Prefix the paths below with `/api/v10`; `/api/v9` and `/api` also work.

Except for `GET /gateway`, send `Authorization: Bot <bot-token>`. The examples use the configured token `fake-local`, not a default token.
Discovery and identity routes accept the relay bot's token or another bot token seeded with `DiscordFake.addBot`.
Guild, member-role, and command routes accept only the relay bot's token; another seeded bot gets `403`, code `50001`.
See [shared REST rules](../index.md#rest-authentication-and-responses) for errors, rate-limit headers, and injected failures.

## Discovery and identity

| Route                                             | Purpose                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| [GET `/gateway`](get-gateway.md)                  | Discover the Gateway URL without authentication.   |
| [GET `/gateway/bot`](get-gateway-bot.md)          | Read the Gateway URL and shared session limits.    |
| [GET `/users/@me`](get-users-me.md)               | Read the authenticated bot's profile.              |
| [PATCH `/users/@me`](patch-users-me.md)           | Change the authenticated bot's username or avatar. |
| [GET `/users/@me/guilds`](get-users-me-guilds.md) | List guilds containing the authenticated bot.      |
| [GET `/applications/@me`](get-applications-me.md) | Read the authenticated bot's application.          |

## Guilds and member roles

| Route                                                                            | Purpose                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------- |
| [GET `/guilds/:guild/channels`](get-guild-channels.md)                           | List non-thread channels in position order.       |
| [GET `/guilds/:guild/roles`](get-guild-roles.md)                                 | List all guild roles.                             |
| [GET `/guilds/:guild/members/:user`](get-guild-member.md)                        | Read one member's user and roles.                 |
| [PUT `/guilds/:guild/members/:user/roles/:role`](put-guild-member-role.md)       | Add a role, subject to permissions and hierarchy. |
| [DELETE `/guilds/:guild/members/:user/roles/:role`](delete-guild-member-role.md) | Remove a role with the same checks.               |

## Guild application commands

| Route                                                                    | Purpose                           |
| ------------------------------------------------------------------------ | --------------------------------- |
| [GET `/applications/:app/guilds/:guild/commands`](get-guild-commands.md) | Read the registered command list. |
| [PUT `/applications/:app/guilds/:guild/commands`](put-guild-commands.md) | Replace the whole command list.   |

## DMs and application emoji

These routes accept only the relay bot's token, not tokens created with `POST /_fake/bots`.

| Route                                                          | Purpose                      |
| -------------------------------------------------------------- | ---------------------------- |
| [POST `/users/@me/channels`](post-users-me-channels.md)        | Open a DM with a known user. |
| [GET `/applications/:app/emojis`](get-application-emojis.md)   | List application emoji.      |
| [POST `/applications/:app/emojis`](post-application-emojis.md) | Create an application emoji. |
