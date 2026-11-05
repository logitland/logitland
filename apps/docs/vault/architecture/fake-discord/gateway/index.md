---
title: Gateway
description: Local WebSocket upgrade paths, JSON frames, identification, resume, heartbeats, events, and close codes.
order: 5
source:
  - label: upgrade routing and bot-token lookup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L205-L221
  - label: defaults
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L66-L77
  - label: upgrade validation and HELLO
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L332-L344
  - label: client opcodes, heartbeats, and rate limit
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L361-L400
  - label: IDENTIFY, READY, and GUILD_CREATE
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L402-L496
  - label: RESUME
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L498-L534
  - label: event intent mapping
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L47-L61
  - label: dispatch and content filtering
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L264-L280
  - label: intent bits and application flags
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L50-L71
  - label: WebSocket framing and handshake
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/websocket.ts#L119-L246
---

Use the [local fake](../index.md) to exercise Gateway clients without connecting to Discord. Neither upgrade path requires an HTTP Authorization header. IDENTIFY and RESUME authenticate inside JSON frames with the fake's bot token or a token registered by `DiscordFake.addBot`.

## Upgrade paths

| Path                                     | Purpose                                |
| ---------------------------------------- | -------------------------------------- |
| [`GET /gateway`](get-gateway-upgrade.md) | Primary Gateway upgrade path.          |
| [`GET /`](get-root-upgrade.md)           | Root-path alias for the same protocol. |

Use `v=9` or `v=10`; `encoding` defaults to `json`. A valid WebSocket handshake returns HTTP `101`, then the fake checks the Gateway query. A missing or unsupported API version closes with `4012`; non-JSON encoding or any `compress` query closes with `4002`. Only valid queries receive HELLO, opcode `10`.

Malformed upgrade handshakes return HTTP `400` without a body. Other upgrade paths destroy the socket. The fake supports uncompressed JSON text with masked client WebSocket frames.

## Connect and identify

HELLO announces the heartbeat interval, in milliseconds. The default is 41,250:

```json
{ "t": null, "s": null, "op": 10, "d": { "heartbeat_interval": 41250 } }
```

Send IDENTIFY, opcode `2`. Required fields are raw bot `token`, object `properties`, and integer `intents`.
Optional `shard` is `[index,count]` with integers `count >= 1` and `0 <= index < count`.
The fake accepts an empty properties object.
Use the fake's printed `bot_token`, without the REST `Bot ` prefix. This example assumes the [fixed-token startup](../index.md) with `fake-local` and subscribes to guilds, guild messages, and message content:

```json
{ "op": 2, "d": { "token": "fake-local", "properties": {}, "intents": 33281 } }
```

Success creates a session and sends opcode `0` dispatches `READY`, then `GUILD_CREATE` for each bot guild.
READY contains `v: 10`, bot `user`, unavailable guild summaries, `session_id`, `resume_gateway_url`, application identity/flags, and `session_type: "normal"`.
It adds `shard` when supplied. Dispatch sequence `s` increases for every session event.
Non-dispatch server frames use `s: null` and `t: null`.

GUILD_CREATE includes roles, members, channels, and active threads.
Without the guilds intent, channels and threads are empty.
Without the guild-members intent, the members array contains only the bot.
Nested channels and threads omit `guild_id`.

Each successful IDENTIFY decrements the session start limit.
When `remaining <= 0`, the fake sends opcode `9`, `d: false`, without creating a session.

## Client opcodes

| Opcode                    | Required input or state                                     | Result                                                               |
| ------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `1` HEARTBEAT             | `d: null` or an integer; works before identification.       | Opcode `11`, `d: null`, unless ACKs are disabled.                    |
| `2` IDENTIFY              | Token, properties, intents; optional shard.                 | READY and GUILD_CREATE; see [identification](#connect-and-identify). |
| `6` RESUME                | Token, session ID, sequence; no session on this connection. | Replay then RESUMED, or [resume failure](#resume).                   |
| `3` PRESENCE UPDATE       | Authenticated connection.                                   | Ignored; otherwise closes `4003`.                                    |
| `4` VOICE STATE UPDATE    | Authenticated connection.                                   | Ignored; otherwise closes `4003`.                                    |
| `8` REQUEST GUILD MEMBERS | Authenticated connection.                                   | Ignored, with no member chunks; otherwise closes `4003`.             |

HEARTBEAT, for example `{"op":1,"d":null}`, updates the heartbeat count and timestamp for authenticated sessions. The fake does not check that an integer heartbeat sequence matches the session or disconnect clients for missing heartbeats. Opcodes `3`, `4`, and `8` do not validate their payloads after authentication.

## Resume

On a new connection after HELLO, send opcode `6` with the same bot's raw `token`, the string `session_id` from READY, and integer `seq` for the last dispatch received:

```json
{ "op": 6, "d": { "token": "fake-local", "session_id": "session-from-ready", "seq": 2 } }
```

The fake replays buffered dispatches after `seq`, then sends RESUMED with `d: {}`. RESUMED takes the next sequence number but does not enter the replay buffer. A successful resume replaces any socket still attached to that session, closing the old socket with `4000`.

Normal resume handling applies these checks:

- An unrecognized token closes `4004`. A recognized token for a different bot cannot resume the session and receives opcode `9`, `d: false`.
- Unknown, expired, or stale sessions receive opcode `9`, `d: false`. The default disconnected resume window is 120,000 milliseconds.
- For an otherwise valid session, a sequence below zero or beyond its latest sequence closes `4007`. Missing replay history receives opcode `9`, `d: false`; the default buffer retains 10,000 dispatches per session.

IDENTIFY or RESUME on an already authenticated connection closes `4005`. An INVALID_SESSION reply leaves an unauthenticated socket open, so a client can retry RESUME or send a fresh IDENTIFY on that socket as appropriate. [Next-resume controls](../control-gateway/post-gateway-next-resume.md) can override normal session and sequence checks.

## Events and intents

| Intent          | Bit     | Forwarded world changes                                                                                                                       |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Guilds          | `1`     | `GUILD_CREATE`, `GUILD_ROLE_CREATE`, `CHANNEL_CREATE`, `CHANNEL_UPDATE`, `CHANNEL_DELETE`, `THREAD_CREATE`, `THREAD_UPDATE`, `THREAD_DELETE`. |
| Guild members   | `2`     | `GUILD_MEMBER_UPDATE`.                                                                                                                        |
| Guild messages  | `512`   | `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `MESSAGE_DELETE_BULK`.                                                                  |
| Message content | `32768` | Keeps other people's content, embeds, attachments, components, and polls in message events.                                                   |

Without Message Content, those fields in MESSAGE_CREATE and MESSAGE_UPDATE become empty and the poll disappears.
The bot's own messages and messages mentioning it keep those fields.
Privileged intents require matching application flags; otherwise IDENTIFY closes `4014`.
The default relay-bot application enables limited Message Content, but not guild-members or presence privileges. Bots added with `DiscordFake.addBot` have no privileged intents enabled.
The fake validates other known intent bits but does not implement their events.

Live world-change dispatches are filtered by intents, not guild membership or channel permissions. Do not use the fake Gateway to validate production access controls. Initial GUILD_CREATE dispatches still go to each bot guild, even without the guilds intent; that intent controls the initial channels and threads arrays.

## Protocol errors

WebSocket framing failures close with `1002`, including unmasked client frames and malformed fragmentation or control frames.
Invalid UTF-8 in text messages closes with `1007`. Messages above 4 MiB close with `1009`, including fragmented messages. Binary WebSocket messages are ignored by the Gateway.

| Close code | Trigger                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `4001`     | Unknown client opcode.                                                                                                          |
| `4002`     | Invalid JSON/object/opcode shape, malformed IDENTIFY/RESUME, invalid heartbeat data, or unsupported encoding/compression query. |
| `4003`     | Opcodes `3`, `4`, or `8` before authentication.                                                                                 |
| `4004`     | Wrong bot token in IDENTIFY or RESUME.                                                                                          |
| `4005`     | IDENTIFY or RESUME on an already authenticated connection.                                                                      |
| `4007`     | RESUME sequence below zero or above the latest sequence.                                                                        |
| `4008`     | More than 120 inbound text frames within 60 seconds on one connection.                                                          |
| `4010`     | Invalid shard tuple.                                                                                                            |
| `4012`     | Missing or unsupported version query.                                                                                           |
| `4013`     | Invalid intent integer or unknown intent bits.                                                                                  |
| `4014`     | Privileged intent without application permission.                                                                               |

Control endpoints can also close with a supplied code, send RECONNECT (`7`) or INVALID_SESSION (`9`), or drop sockets.
The server does not implement voice, member chunks, compressed payloads, or ETF.
