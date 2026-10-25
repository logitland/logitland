---
title: Fake Discord Gateway WebSocket
description: Local WebSocket upgrade paths, JSON frames, identification, resume, heartbeats, events, and close codes.
---

The [local fake](index.md) accepts WebSocket upgrades on both `/gateway` and `/`.
Neither upgrade requires an HTTP Authorization header. IDENTIFY and RESUME authenticate inside JSON frames.
Other upgrade paths destroy the socket.

| Upgrade path                          | Required/default queries                                                          | Concrete URL                                     | Source                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `GET /gateway` with WebSocket upgrade | `v=9` or `v=10` required. `encoding` defaults to `json`. No `compress` parameter. | `ws://127.0.0.1:8790/gateway?v=10&encoding=json` | [path dispatch](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L201) |
| `GET /` with WebSocket upgrade        | Same queries and protocol.                                                        | `ws://127.0.0.1:8790/?v=10&encoding=json`        | [path dispatch](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L201) |

A valid WebSocket handshake upgrades with `101`.
An invalid handshake returns HTTP `400` without a body.
Missing/wrong API version closes with `4012`.
Non-JSON encoding or any `compress` query closes with `4002`.
The fake supports uncompressed JSON text, with masked client WebSocket frames.

Sources: [upgrade validation and HELLO](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L330),
[WebSocket handshake](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/websocket.ts#L235).

## Connect and identify

The server sends HELLO, opcode `10`, immediately after a valid upgrade.
The default interval is 41,250 milliseconds:

```json
{ "t": null, "s": null, "op": 10, "d": { "heartbeat_interval": 41250 } }
```

Send IDENTIFY, opcode `2`. Required fields are raw bot `token`, object `properties`, and integer `intents`.
Optional `shard` is `[index,count]` with integers `count >= 1` and `0 <= index < count`.
The fake accepts an empty properties object.
This example subscribes to guilds, guild messages, and message content:

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

Sources: [IDENTIFY validation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L401),
[READY](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L430),
[GUILD_CREATE](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L458).

## Client opcodes

| Opcode                    | Input and authentication                                                                                  | Success or error                                                                                                 | Concrete frame                                                                  | Source                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `1` HEARTBEAT             | `d` must be `null` or an integer sequence. Works before identification too.                               | Opcode `11`, `d: null`, unless ACKs are disabled through control. Tracks count/time for authenticated sessions.  | `{"op":1,"d":null}`                                                             | [heartbeat](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L392)       |
| `2` IDENTIFY              | Bot token, properties object, intents; optional shard.                                                    | READY/GUILD_CREATE or the errors below. Identifying an authenticated connection closes `4005`.                   | `{"op":2,"d":{"token":"fake-local","properties":{},"intents":513}}`             | [identify](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L401)        |
| `6` RESUME                | Required raw bot `token`, string `session_id`, integer `seq`. Connection must not already have a session. | Replays buffered dispatches after `seq`, then sends `RESUMED` with `d: {}`. Invalid sessions receive opcode `9`. | `{"op":6,"d":{"token":"fake-local","session_id":"session-from-ready","seq":2}}` | [resume](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L494)          |
| `3` PRESENCE UPDATE       | Requires an authenticated connection. Payload otherwise unchecked.                                        | Ignored. Unauthenticated use closes `4003`.                                                                      | `{"op":3,"d":{}}`                                                               | [opcode dispatch](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L375) |
| `4` VOICE STATE UPDATE    | Requires an authenticated connection. Payload otherwise unchecked.                                        | Ignored. Unauthenticated use closes `4003`.                                                                      | `{"op":4,"d":{}}`                                                               | [opcode dispatch](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L375) |
| `8` REQUEST GUILD MEMBERS | Requires an authenticated connection. Payload otherwise unchecked.                                        | Ignored; no member chunk response. Unauthenticated use closes `4003`.                                            | `{"op":8,"d":{}}`                                                               | [opcode dispatch](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L375) |

RESUME fails with opcode `9`, `d: false`, for unknown, expired, stale, or unreplayable sessions.
The default disconnected resume window is 120,000 milliseconds.
The default replay buffer keeps 10,000 dispatches per session.
A sequence below zero or beyond the session's latest sequence closes `4007`.
Resuming replaces any existing socket attached to that session.
RESUMED takes the next sequence number but does not enter the replay buffer.
[Gateway controls](control-gateway.md) can force invalid or resumable-invalid responses.

## Events and intents

| Intent          | Bit     | Forwarded world changes                                                                                                                       |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Guilds          | `1`     | `GUILD_CREATE`, `GUILD_ROLE_CREATE`, `CHANNEL_CREATE`, `CHANNEL_UPDATE`, `CHANNEL_DELETE`, `THREAD_CREATE`, `THREAD_UPDATE`, `THREAD_DELETE`. |
| Guild members   | `2`     | `GUILD_MEMBER_UPDATE`.                                                                                                                        |
| Guild messages  | `512`   | `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `MESSAGE_DELETE_BULK`.                                                                  |
| Message content | `32768` | Keeps other people's content, embeds, attachments, components, and polls in message events.                                                   |

Without Message Content, those message fields become empty and the poll disappears.
The bot's own messages and messages mentioning it keep those fields.
Privileged intents require matching application flags; otherwise IDENTIFY closes `4014`.
The default application enables limited Message Content, but not guild-members or presence privileges.
The fake validates other known intent bits but does not implement their events.

Sources: [event filtering](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L47),
[content filtering](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L262),
[intent bits and application flags](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L50).

## Protocol errors

WebSocket framing failures close with `1002`, including unmasked client frames and malformed fragmentation or control frames.
Invalid UTF-8 closes with `1007`. Messages above 4 MiB close with `1009`, including fragmented messages.

Source: [WebSocket frame validation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/websocket.ts#L119).

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

Sources: [text frame parsing and rate limit](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L360),
[close codes](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L26).
