---
title: Fake Discord bot REST
description: Discovery, bot and application identity, guild reads, member roles, and application commands.
---

These routes belong to the [local fake](index.md). Prefix every path with `/api/v10`.
All require `Authorization: Bot fake-local`, except `GET /gateway`.
No body or query is required unless listed. All successful responses use `200`, except role changes with `204`.
The [shared REST errors](index.md#rest-authentication-and-responses) also apply.

## Discovery and identity

| Method and path         | Inputs and result                                                                                                                                                                               | Concrete request                | Source                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /gateway`          | No auth. Returns `{"url":"ws://127.0.0.1:8790/gateway"}` at this example port.                                                                                                                  | `GET /api/v10/gateway`          | [gateway.get](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L206)     |
| `GET /gateway/bot`      | Returns `url`, `shards: 1`, and `session_start_limit` with `total`, `remaining`, `reset_after` in milliseconds, and `max_concurrency`. Initially 1,000 total and remaining; concurrency is one. | `GET /api/v10/gateway/bot`      | [gateway.bot](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L208)     |
| `GET /users/@me`        | Returns the bot User with `verified: true`, `mfa_enabled: false`, and `flags: 0`. Bearer credentials select the separate [OAuth handler](oauth.md).                                             | `GET /api/v10/users/@me`        | [users.me](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L222)        |
| `GET /applications/@me` | Returns application identity, bot, verification key, owner, team, flags, interaction URL, and install parameters.                                                                               | `GET /api/v10/applications/@me` | [applications.me](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L224) |

The application object defaults to `bot_public: false`, `bot_require_code_grant: false`, `description: ""`, and `team: null`.
Its `flags_new` is the string form of `flags`.
Install parameters contain scopes `bot` and `applications.commands`, with permissions `"0"`.
A team-owned application returns a synthetic team owner and team members with role `admin`.

Sources: [application object](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L254),
[session limit defaults](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L171).

## Guilds and member roles

| Method and path                                   | Inputs and result                                        | Errors beyond shared authentication                                                               | Concrete request                                                                                | Source                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /guilds/:guild/channels`                     | Returns non-thread Channels sorted by `position`.        | `404/10004` unknown guild; `403/50001` bot absent from guild.                                     | `GET /api/v10/guilds/100000000000000010/channels`                                               | [guild.channels](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L228)           |
| `GET /guilds/:guild/roles`                        | Returns the guild's Role array.                          | `404/10004`; `403/50001` bot absent.                                                              | `GET /api/v10/guilds/100000000000000010/roles`                                                  | [guild.roles](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L234)              |
| `GET /guilds/:guild/members/:user`                | Returns the Member, including `user` and `roles`.        | `404/10004` unknown guild; `404/10007` unknown member.                                            | `GET /api/v10/guilds/100000000000000010/members/100000000000000030`                             | [guild.member.get](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L240)         |
| `PUT /guilds/:guild/members/:user/roles/:role`    | Adds the role. No body. Returns `204` without a body.    | `404` unknown guild/member/role; `403/50013` missing Manage Roles or insufficient role hierarchy. | `PUT /api/v10/guilds/100000000000000010/members/100000000000000030/roles/100000000000000040`    | [guild.member.role.add](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L262)    |
| `DELETE /guilds/:guild/members/:user/roles/:role` | Removes the role. No body. Returns `204` without a body. | Same checks as role addition.                                                                     | `DELETE /api/v10/guilds/100000000000000010/members/100000000000000030/roles/100000000000000040` | [guild.member.role.remove](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L263) |

Role changes require the bot's highest role to exceed the target role.
Managed roles also fail this check. The guild owner bypasses that hierarchy restriction.
Successful changes emit `GUILD_MEMBER_UPDATE`.

Source: [shared role-change handler](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L247).

## Guild application commands

Both routes require `:app` to equal the fake application's ID and `:guild` to exist.
A different application returns `403/50001`. An unknown guild returns `404/10004`.

| Method and path                                 | Inputs and result                                                                                 | Concrete request                                                                                       | Source                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `GET /applications/:app/guilds/:guild/commands` | Returns the ApplicationCommand array, or `[]` before registration.                                | `GET /api/v10/applications/100000000000000001/guilds/100000000000000010/commands`                      | [commands.list](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L271) |
| `PUT /applications/:app/guilds/:guild/commands` | Replaces all guild commands with the JSON array. Maximum 100. Returns stored ApplicationCommands. | `PUT /api/v10/applications/100000000000000001/guilds/100000000000000010/commands` with the body below. | [commands.put](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L275)  |

```json
[{ "name": "mirror", "description": "Manage mirroring" }]
```

Each command needs `name`, and slash commands also need `description` of 1–100 characters.
`type` defaults to `1`; accepted values are `1`, `2`, and `3`.
Names contain 1–32 letters, numbers, hyphens, underscores, or apostrophes.
Slash-command names must be lowercase. The pair of `type` and `name` must be unique.
Types `2` and `3` store an empty description.

`options` is optional, with at most 25 entries per level.
Each option needs a numeric `type` from 1 through 11, a lowercase valid name, and a 1–100 character description.
Nested `options` follow the same checks.
`default_member_permissions` stores a string or defaults to `null`.
`nsfw` defaults to `false`; `integration_types` and `contexts` both become `[0]`.
Repeated PUTs retain IDs for matching type/name pairs and assign a new shared `version`.
Invalid arrays, names, duplicates, descriptions, or options return `400/50035` with field errors.

Source: [option validation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L553).
