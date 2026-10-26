---
title: GET /applications/@me
description: Fake Discord bot REST route that returns the expanded application object.
---

[Fake Discord](../index.md) / [Bot REST](../bot-rest.md)

Returns the fake application's identity, bot, verification key, owner, team, flags, interaction URL, and install parameters.
Route name `applications.me`.

## Request

- Path: `/api/v10/applications/@me`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Body and query: none.

```sh
curl http://127.0.0.1:8790/api/v10/applications/@me \
  -H 'Authorization: Bot fake-local'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.

## Response

`200` with `id`, `name`, `icon: null`, `description: ""`, `bot_public: false`, and `bot_require_code_grant: false`.
It adds the bot User as `bot`, the signing public key as `verify_key`, `owner`, `team`, `flags`, `flags_new`, `interactions_endpoint_url`, and `install_params`.

- `flags_new` is the string form of `flags`.
- `install_params` has scopes `bot` and `applications.commands`, with permissions `"0"`.
- `team` is `null` by default.
  A team-owned application returns a synthetic team owner, and team members with role `admin`.

[`PATCH /_fake/application`](../control-seeding/patch-application.md) changes the endpoint URL, team, and Message Content flags.
That control route returns the fake's smaller stored object instead.

## Errors

- `401/0`: missing or wrong bot token.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

Sources: [applications.me](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L224),
[application object](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L254).
