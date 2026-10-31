---
title: Fake Discord
description: Setup, shared rules, and endpoint groups for the local, in-memory Discord fake.
order: 4
---

`@logitland/discord-fake` runs a local Discord replacement for development and tests.
Its guilds, messages, webhooks, OAuth tokens, and Gateway sessions live in memory.
These endpoints belong to the fake process, not the deployed relay.
Keep the fake on loopback: the control API is unauthenticated and exposes tokens and request records.
Use only local test credentials, not real Discord credentials.

Start an empty fake with a fixed bot token and application ID:

```sh
node packages/discord-fake/src/cli.ts --port 8790 --bot-token fake-local --application-id 100000000000000001
```

The default host is `127.0.0.1`. The default port is `0`, which selects a free port.
The CLI prints the addresses, bot token, application ID, and signing public key as JSON.
Add `--seed dev` for the sample community. Its fixed IDs differ from this reference's explicit example IDs.

Sources: [CLI](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/cli.ts#L1),
[startup](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L224).

Point a development relay at `DISCORD_API_BASE=http://127.0.0.1:8790/api/v10` with `RELAY_MODE=development`.
Use the fake's printed `bot_token`, `application_id`, and `public_key` for the corresponding Discord credentials.
Set `DISCORD_GUILD_ID` to the seeded or created guild's ID. Development mode also requires a local `PUBLIC_URL`;
the relay rejects `DISCORD_API_BASE` outside development mode. To configure the local stack automatically,
run `pnpm dev:full` from the repository root.

Sources: [development-only override](https://github.com/logitland/logitland/blob/main/packages/relay/src/config.ts#L94),
[REST client configuration](https://github.com/logitland/logitland/blob/main/packages/relay/src/index.ts#L57).

## Endpoint groups

The source registers 33 REST routes and 37 control handlers.
One control handler accepts both `DELETE /_fake/failures` and `DELETE /_fake/failures/:id`, making 38 control request forms.
OAuth adds three handlers, including a Bearer-token variant of REST's `GET /users/@me`.
The Gateway accepts WebSocket upgrades at `/gateway` and `/`.

| Reference                                           | Coverage                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Bot REST](bot-rest/index.md)                       | Discovery, bot identity/profile, guild listing, application, guild reads, roles, commands, DMs, and application emoji. 16 routes and 16 endpoint pages. |
| [Messages and threads](messages-threads/index.md)   | Channels, bot messages, webhook creation, and thread management. 11 routes and 11 endpoint pages.                                                       |
| [Webhook REST](webhooks/index.md)                   | Six routes, including interaction follow-up branches.                                                                                                   |
| [Control seeding](control-seeding/index.md)         | State, guilds, channels, roles, members, bots, webhooks, and application settings. Eight handlers and eight endpoint pages.                             |
| [Control actions](control-actions/index.md)         | People, messages, threads, member roles, and signed interactions. 11 handlers.                                                                          |
| [Control diagnostics](control-diagnostics/index.md) | Logs, failure injection, clearing, and rate limits. Eight request forms.                                                                                |
| [Control Gateway](control-gateway/index.md)         | Gateway inspection and fault controls. 11 handlers.                                                                                                     |
| [OAuth](oauth/index.md)                             | Local user selection, code exchange, and user identity.                                                                                                 |
| [Gateway WebSocket](gateway/index.md)               | Upgrade paths, client opcodes, events, authentication, and close codes.                                                                                 |

## Example conventions

Examples use `http://127.0.0.1:8790`. Replace it with the fake's printed `url`.
REST examples include `/api/v10`; `/api/v9` and `/api` also work.
Path parameters such as `:guild` and `:channel` are required.
Request examples give the method, concrete path, and JSON body where applicable.
For example:

```sh
curl http://127.0.0.1:8790/api/v10/users/@me \
  -H 'Authorization: Bot fake-local'

curl http://127.0.0.1:8790/_fake/guilds \
  -H 'Content-Type: application/json' \
  -d '{"id":"100000000000000010","name":"Test server"}'
```

Use [control seeding](control-seeding/index.md) to create the example guild, channel, member, role, and webhook.
Messages normally receive generated IDs; direct TypeScript fixtures can supply explicit message IDs.
A thread started from a message reuses that message's ID; standalone threads and forum posts receive generated IDs.
Substitute returned IDs in later requests.

## REST authentication and responses

Bot routes require exactly `Authorization: Bot <bot-token>`.
Routes marked `any-bot` accept the primary bot or a bot registered with `addBot()` / `POST /_fake/bots`.
Routes marked `bot` reject registered additional bots with `403`, code `50001`; other routes still apply their own
membership and permission checks. An additional bot starts in no guild until added as a member.
Webhook routes use their path token instead. `GET /api/v10/gateway` needs neither.
OAuth's user lookup uses `Authorization: Bearer <access-token>`.
The control API has **no authentication**.

Non-empty REST mutation bodies use `Content-Type: application/json`.
Malformed JSON returns `400`, code `50109`. A wrong content type returns `400`, code `50035`.
REST reads the body before dispatch and rejects bodies larger than 26,214,400 bytes with `413`, code `0`.
GET and DELETE handlers ignore JSON/content-type errors, but the body-size limit still applies.
Unknown REST paths return `404`, code `0`; a known path with an unsupported method returns `405`, code `0`.
There is no general CORS or OPTIONS handler.

Sources: [dispatcher and body parsing](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L558),
[REST body limit](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L141),
[bot authentication](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L671).

REST errors have Discord's shape:

```json
{ "message": "401: Unauthorized", "code": 0 }
```

Validation errors add a nested `errors` object:

```json
{
  "message": "Invalid Form Body",
  "code": 50035,
  "errors": {
    "name": {
      "_errors": [{ "code": "BASE_TYPE_REQUIRED", "message": "This field is required" }]
    }
  }
}
```

| Status | Codes used by the fake                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `50035` invalid fields; `50109` invalid JSON; `50006` empty message; `50024` wrong channel type; `50083` archived thread.                 |
| `400`  | `10087` unknown tag; `160004` existing message thread; `30007` webhook limit; `40058` direct forum message; `50033` invalid DM recipient. |
| `400`  | `220001` missing forum thread; `220002` conflicting forum thread inputs; `220003` forum-only inputs elsewhere.                            |
| `401`  | `0` invalid bot credentials; `50027` invalid webhook or interaction token.                                                                |
| `403`  | `50001` missing access; `50013` missing permissions; `50005` editing another author's message; `50007` closed DMs.                        |
| `404`  | `10003` channel; `10004` guild; `10007` member; `10008` message; `10011` role; `10015` webhook.                                           |

An interaction follow-up attempted before acknowledgement returns `404`, code `10015` (Unknown Webhook).

Sources: [error definitions](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L252),
[validation error builder](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L304).

Matched REST routes normally return rate-limit headers, including authentication and validation failures.
Unknown routes, oversized bodies, dropped connections, OAuth, and control responses do not carry these bucket headers.
Default limits are five requests per two seconds per webhook, and 50 per second for other buckets.
Enforcement defaults to `false`; [control diagnostics](control-diagnostics/index.md) can enable it or inject failures.
An exhausted enforced bucket returns `429` with `retry_after`, `global: false`, and `Retry-After`.
Wait for `Retry-After` before retrying a rate-limited request. A dropped or delayed response does not prove that a
message was not posted; inspect the fake's messages before retrying an uncertain send.
Injected failures run before authentication and can replace the documented route result.

Source: [buckets, headers, and failure handling](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L513).

## Returned objects

Tables name the actual object types rather than repeat every field.
A Message contains IDs, author, content, timestamps, mentions, embeds, attachments, components, type, and flags.
A guild Channel contains IDs, type, name, parent, position, overwrites, and optional thread metadata or forum tags.
A DM Channel has `type: 1`, `id`, `last_message_id` and `recipients`; only the relay bot can open and send to it.
DM message reads, edits, deletes and Gateway events are not implemented; see [opening a DM](bot-rest/post-users-me-channels.md).
Permission bitfields are decimal strings.

Sources: [User, Role, and Member](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L74),
[Channel and Webhook](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L138),
[Message](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L181),
[ApplicationCommand](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L219).
