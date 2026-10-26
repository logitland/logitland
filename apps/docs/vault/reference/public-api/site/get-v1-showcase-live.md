---
title: GET /v1/showcase/live
description: Public WebSocket feed of changes in the curated home channels.
---

[Site and discovery](../site.md) · [Public API](../index.md)

Opens a public WebSocket for changes in curated home channels.
Send `Upgrade: websocket` and a standard WebSocket handshake.
There is no bearer token or query parameter.
A successful handshake returns `101 Switching Protocols`.

```js
const feed = new WebSocket('wss://relay.example/v1/showcase/live');
feed.onmessage = (event) => console.log(JSON.parse(event.data));
```

Example text frame:

```json
{ "type": "message.deleted", "channel_id": "123456789012345678", "message_ids": ["123456789012345679"] }
```

| Frame `type`       | Other fields                       |
| ------------------ | ---------------------------------- |
| `message.created`  | `at`, `message`                    |
| `message.updated`  | `message`                          |
| `message.deleted`  | `channel_id`, `message_ids`        |
| `post.updated`     | `post`                             |
| `post.removed`     | `channel_id`, `post_id`            |
| `showcase.changed` | None; read the home channels again |

Message objects follow the [history message shape](../reading/get-v1-channels-id-messages.md).
Post objects follow the [thread shape](../reading/get-v1-channels-id-threads.md).
`at` is the relay clock in milliseconds.
Read initial history separately; this socket does not send an initial snapshot.

Send the text `ping` to receive `pong`. Other client messages close the socket with `1008`.
Each address may hold eight sockets; the feed allows 10,000 total.
An exceeded connection limit returns `429`.
A request without a WebSocket upgrade returns `426 invalid_request`.
A missing showcase binding returns `503 unavailable`.
Refusals use the [problem format](../index.md#errors).

Sources: [route](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/site.ts#L32),
[frames](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1103),
[connection limits and keepalive](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L13),
[publication](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/showcase.ts#L62).
