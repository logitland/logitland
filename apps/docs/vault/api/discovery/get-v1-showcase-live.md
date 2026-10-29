---
title: GET /v1/showcase/live
description: Public WebSocket feed of changes in the curated home channels.
order: 7
operation:
  protocol: websocket
  path: /v1/showcase/live
  server: https://relay.example
  auth: { scheme: none }
  responses:
    '101': { description: Switching Protocols. }
    '426': { description: No WebSocket upgrade (invalid_request). }
    '429': { description: Eight connections per address or 10000 total exceeded. }
    '503': { description: Showcase binding unavailable. }
  messages:
    - { direction: send, name: ping, description: Keepalive request., example: ping }
    - { direction: receive, name: pong, description: Keepalive response., example: pong }
    - direction: receive
      name: message.created
      description: A new message; at is the relay clock in milliseconds and message follows the history message shape.
    - direction: receive
      name: message.updated
      description: An updated message following the history message shape.
    - direction: receive
      name: message.deleted
      description: Messages removed from a curated channel.
      example: { type: message.deleted, channel_id: '123456789012345678', message_ids: ['123456789012345679'] }
    - direction: receive
      name: post.updated
      description: A post following the thread shape.
    - direction: receive
      name: post.removed
      description: A removed post, with channel_id and post_id.
    - direction: receive
      name: showcase.changed
      description: The curated channels changed; read the home channels again.
      example: { type: showcase.changed }
  close:
    '1008': Client sent a message other than the text ping.
source:
  - https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/site.ts#L32
  - https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1182
  - https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L13
  - https://github.com/logitland/logitland/blob/main/packages/relay/src/services/showcase.ts#L62
---

Opens a public WebSocket for changes in curated home channels.
Send `Upgrade: websocket` and a standard WebSocket handshake.
There is no bearer token or query parameter.
A successful handshake returns `101 Switching Protocols`.

```js
const feed = new WebSocket('wss://relay.example/v1/showcase/live');
feed.onmessage = (event) => {
  if (event.data === 'pong') return;
  console.log(JSON.parse(event.data));
};
```

| Frame `type`       | Other fields                       |
| ------------------ | ---------------------------------- |
| `message.created`  | `at`, `message`                    |
| `message.updated`  | `message`                          |
| `message.deleted`  | `channel_id`, `message_ids`        |
| `post.updated`     | `post`                             |
| `post.removed`     | `channel_id`, `post_id`            |
| `showcase.changed` | None; read the home channels again |

Message objects follow the [history message shape](../channels/get-v1-channels-id-messages.md).
Post objects follow the [thread shape](../channels/get-v1-channels-id-threads.md).
`at` is the relay clock in milliseconds.
Read initial history separately; this socket does not send an initial snapshot.
The optional text frame `ping` receives the text `pong`, not JSON. Sending any other client message closes the socket with code `1008`.

Each address may hold eight sockets; the feed allows 10,000 total.
Refusals use the [problem format](../index.md#errors).
