---
title: Get the application
description: Return the fake application's expanded object.
operation:
  method: GET
  path: /api/v10/applications/@me
  server: http://127.0.0.1:8790
  parameters:
    - name: Authorization
      in: header
      required: true
      type: string
      description: The fake bot token.
      example: Bot fake-local
  responses:
    '200':
      contentType: application/json
      description: The application object.
    '401':
      description: Missing or wrong bot token (`0`).
source:
  - label: applications.me
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L224
  - label: application object
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L254
---

Route name `applications.me`. The `/api/v9` and `/api` prefixes also work.

The object has `id`, `name`, `icon: null`, `description: ""`, `bot_public: false`, and `bot_require_code_grant: false`.
It includes the bot User as `bot`, the signing public key as `verify_key`, `owner`, `team`, `flags`, `flags_new`, `interactions_endpoint_url`, and `install_params`.

- `flags_new` is the string form of `flags`.
- `install_params` has scopes `bot` and `applications.commands`, with permissions `"0"`.
- `team` is `null` by default.
  A team-owned application returns a synthetic team owner, and team members with role `admin`.

[`PATCH /_fake/application`](../control-seeding/patch-application.md) changes the endpoint URL, team, and Message Content flags.
That control route returns the fake's smaller stored object instead.

- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
