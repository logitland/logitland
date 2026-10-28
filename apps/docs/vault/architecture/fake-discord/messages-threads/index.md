---
title: Messages and threads
description: Bot channel reads, message creation, webhook creation, and thread routes.
order: 2
---

These [local fake](../index.md) routes require `Authorization: Bot fake-local`. Prefix paths with `/api/v10`; `/api/v9` and `/api` also work. Mutations use JSON bodies. Unknown channels return `404/10003`; permission failures return `403/50013`; invalid fields return `400/50035`. The [shared REST errors](../index.md#rest-authentication-and-responses) also apply.

## Channels and messages

- [GET `/channels/:channel`](get-channel.md)
- [POST `/channels/:channel/webhooks`](post-channel-webhooks.md)
- [GET `/channels/:channel/messages`](get-channel-messages.md)
- [POST `/channels/:channel/messages`](post-channel-messages.md)

## Message body

See the [message body inputs](post-channel-messages.md#message-body).

## Threads

- [POST `/channels/:channel/messages/:message/threads`](post-message-threads.md)
- [POST `/channels/:channel/threads`](post-channel-threads.md)
- [PUT `/channels/:channel/thread-members/:user`](put-thread-member.md)
- [DELETE `/channels/:channel/thread-members/:user`](delete-thread-member.md)
- [PATCH `/channels/:channel`](patch-channel.md)
