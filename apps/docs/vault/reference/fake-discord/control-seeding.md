---
title: Fake Discord control seeding
description: Unauthenticated local endpoints for building a fake guild and changing application settings.
---

The control API belongs to the [local, in-memory fake](index.md) and has **no authentication**.
All paths on this page start with `/_fake`.
Every successful control request returns `200` JSON, including changes and deletions.

Missing required fields, wrong field types, invalid JSON, and world errors return `400` with `{"error":"message"}`.
Unknown control paths and unsupported methods return `404` with the same shape.
The control handler parses JSON without checking Content-Type. Use `application/json` in clients.
An empty request body becomes `{}`.

Source: [control dispatch and errors](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L453).

## Seed a world

These examples use explicit IDs so later reference examples can reuse them.
Run guild creation before its channels, roles, and members.

| Method and path        | Required/default inputs                                                                                                                            | Success JSON                                                                                                                                                              | Concrete example body or request                                                                        | Source                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /_fake/state`     | None.                                                                                                                                              | Snapshot with `url`, `api_base`, `gateway_url`, `bot_token`, `public_key`, `application`, `guilds`, `gateway`, `rate_limits`, `failures`, and request/interaction counts. | `GET /_fake/state`                                                                                      | [state](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L108)    |
| `POST /_fake/guilds`   | Optional strings `id`, `name`, `owner_id`. Name defaults to `Test server`. IDs and owner otherwise generate.                                       | `{id,name,everyone_role_id,bot_role_id,owner_id}`. Adds owner and bot members, @everyone, and the bot role at position 10.                                                | `{"id":"100000000000000010","name":"Test server"}`                                                      | [guilds](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L121)   |
| `POST /_fake/channels` | Required strings `guild`, `name`. Optional `id`, `kind` (default `text`), numeric `type` overriding kind, `parent`, `topic`, `tags`, `overwrites`. | Channel summary described below.                                                                                                                                          | `{"guild":"100000000000000010","id":"100000000000000020","name":"general","kind":"text"}`               | [channels](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L130) |
| `POST /_fake/roles`    | Required `guild`, `name`. Optional `id`, decimal-string `permissions` (default `"0"`), numeric `position` (default `1`).                           | Role object. Unknown guild returns `400` with `error: "Unknown Guild"`.                                                                                                   | `{"guild":"100000000000000010","id":"100000000000000040","name":"Mirror","position":5}`                 | [roles](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L153)    |
| `POST /_fake/members`  | Required `guild`. Optional `id`, `username`, `global_name`, array `roles` (default `[]`). Username defaults to `user-<ID suffix or user count>`.   | `{id,username,roles}`. Unknown guild/role returns `400` with its error message.                                                                                           | `{"guild":"100000000000000010","id":"100000000000000030","username":"alice"}`                           | [members](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L162)  |
| `POST /_fake/webhooks` | Required `channel`. Optional `id`, `token`, `name` (default `Logitland`). Missing ID and token generate.                                           | Webhook plus `url` in Discord format and `fakeUrl` pointing to this fake. Unknown channel returns `400`.                                                                  | `{"channel":"100000000000000020","id":"100000000000000050","token":"local-hook-token","name":"Mirror"}` | [webhooks](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L176) |

State exposes credentials intentionally for local tests.
Its guild entries contain roles, member summaries, and channel summaries.
The channel summary contains `id`, `name`, `type`, `parent_id`, `webhooks`, and message count `messages`.
Forums add `available_tags`; threads add `archived` and `locked`.
Summary webhooks use `fake_url`; webhook creation uses the different key `fakeUrl`.

Sources: [snapshot](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L57),
[channel summary](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L35),
[webhook creation result](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L327).

Channel kinds are `text`, `voice`, `category`, `announcement`, `forum`, and `media`.
Their numeric types are `0`, `2`, `4`, `5`, `15`, and `16`.
Tags accept `id`, required `name`, and optional `moderated` (default `false`).
Overwrites accept `id`, `type: "role" | "member"`, and decimal-string `allow` and `deny`, each defaulting to `"0"`.

This second channel example creates a forum with an explicit tag ID:

```json
{
  "guild": "100000000000000010",
  "id": "100000000000000021",
  "name": "ideas",
  "kind": "forum",
  "tags": [{ "id": "100000000000000070", "name": "idea" }],
  "overwrites": [{ "id": "100000000000000010", "type": "role", "deny": "2048" }]
}
```

Sources: [channel types](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L4),
[world defaults](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L134),
[channel and tag creation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L231).

## Application settings

`PATCH /_fake/application` changes any supplied fields and returns the application object.

| Field                       | Behavior                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `interactions_endpoint_url` | Sets the endpoint receiving simulated interactions. `null` or an empty value clears it.              |
| `team`                      | Array of developer user IDs. `null` clears the team.                                                 |
| `messageContent`            | `limited`, `full`, or `off`. Sets flags to `524288`, `262144`, or `0`. Invalid strings return `400`. |

```sh
curl -X PATCH http://127.0.0.1:8790/_fake/application \
  -H 'Content-Type: application/json' \
  -d '{"interactions_endpoint_url":"http://127.0.0.1:8787/v1/discord/interactions","messageContent":"limited"}'
```

The response contains `id`, `name`, `flags`, `interactions_endpoint_url`, `owner_id`, and `team`.
These are the fake's stored fields, distinct from `GET /api/v10/applications/@me`'s expanded object.

Source: [application patch](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L426).
