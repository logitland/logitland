---
title: 'PUT /applications/:app/guilds/:guild/commands'
description: Fake Discord bot REST route that replaces a guild's application commands, with Discord's validation.
---

[Fake Discord](../index.md) / [Bot REST](../bot-rest.md)

Replaces all guild commands for the fake application with the JSON array. Route name `commands.put`.

## Request

- Path: `/api/v10/applications/:app/guilds/:guild/commands`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameters: `:app` must equal the fake's application ID. `:guild` must exist.
- Body: a JSON array of at most 100 commands, with `Content-Type: application/json`.

```sh
curl -X PUT http://127.0.0.1:8790/api/v10/applications/100000000000000001/guilds/100000000000000010/commands \
  -H 'Authorization: Bot fake-local' \
  -H 'Content-Type: application/json' \
  -d '[{"name":"mirror","description":"Manage mirroring"}]'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
The example application ID comes from `--application-id 100000000000000001`.
The guild comes from [`POST /_fake/guilds`](../control-seeding/post-guilds.md) with an explicit ID.

### Command fields

- `type` defaults to `1`. Accepted values are `1`, `2`, and `3`.
- `name` is required: 1–32 letters, numbers, hyphens, underscores, or apostrophes.
  Slash-command names (type `1`) must be lowercase. The pair of `type` and `name` must be unique.
- `description` is required for slash commands, 1–100 characters. Types `2` and `3` store an empty description.
- `options` is optional, with at most 25 entries per level.
  Each option needs a numeric `type` from 1 through 11, a lowercase valid name, and a 1–100 character description.
  Nested `options` follow the same checks.
- `default_member_permissions` stores a string, or defaults to `null`.
- `nsfw` defaults to `false`. `integration_types` and `contexts` both become `[0]`.

## Response

`200` with the stored ApplicationCommand array.
Repeated PUTs keep the IDs of matching type/name pairs and assign one new shared `version`.
[`GET` on the same path](get-guild-commands.md) returns the stored array.

## Errors

- `401/0`: missing or wrong bot token.
- `403/50001`: `:app` is a different application.
- `404/10004`: unknown guild.
- `400/50035`: a non-array body, more than 100 commands, or an invalid name, duplicate, description, or option.
  The response names the failing field in `errors`.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.

Sources: [commands.put](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L275),
[option validation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L553).
