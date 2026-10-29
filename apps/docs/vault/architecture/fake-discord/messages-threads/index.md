---
title: Messages and threads
description: Bot channel reads, message creation, webhook creation, and thread routes.
order: 2
source:
  - label: channel and thread routes
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L475-L660
  - label: bot authentication boundaries
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L671-L676
---

These [local fake](../index.md) routes use bot authentication. Replace the example `Authorization: Bot fake-local` with the fake's configured bot token. Most routes accept only the relay bot; a registered other bot can create, edit, and delete its own guild/thread messages and create forum/media posts, but receives `403/50001` on relay-only routes and on thread creation outside forum/media parents.

Prefix paths with `/api/v10`; `/api/v9` and `/api` also work. POST and PATCH bodies use JSON. Unknown channels return `404/10003`; missing permissions usually return `403/50013`, while message listing without View Channel returns `403/50001`. Invalid fields return `400/50035`. The [shared REST rules](../index.md#rest-authentication-and-responses) cover other errors, rate-limit headers, and injected failures.

DM channels support only [message creation](post-channel-messages.md#dm-messages), and only with the relay bot token.
Channel reads, message listing, editing and deletion below require a guild channel or thread, not a DM channel.

## Channels and messages

All 11 registered routes in this family have endpoint pages below.

| Route                                                                      | Purpose                                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [GET `/channels/:channel`](get-channel.md)                                 | Read a channel or thread without a channel-permission check.                  |
| [POST `/channels/:channel/webhooks`](post-channel-webhooks.md)             | Create a webhook with Manage Webhooks.                                        |
| [GET `/channels/:channel/messages`](get-channel-messages.md)               | Page messages with content filtering.                                         |
| [POST `/channels/:channel/messages`](post-channel-messages.md)             | Post as the authenticated bot; DMs accept only the relay bot.                                                |
| [PATCH `/channels/:channel/messages/:message`](patch-channel-message.md)   | Edit the authenticated bot's own message.                                     |
| [DELETE `/channels/:channel/messages/:message`](delete-channel-message.md) | Delete a message, with Manage Messages required for another author's message. |

## Message body

See the [message body inputs](post-channel-messages.md#message-body).

## Threads

| Route                                                                          | Purpose                                                  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| [POST `/channels/:channel/messages/:message/threads`](post-message-threads.md) | Start a thread from an existing message.                 |
| [POST `/channels/:channel/threads`](post-channel-threads.md)                   | Create a standalone thread or a forum/media post.        |
| [PUT `/channels/:channel/thread-members/:user`](put-thread-member.md)          | Add a guild member to an active thread.                  |
| [DELETE `/channels/:channel/thread-members/:user`](delete-thread-member.md)    | Remove a member from an active thread.                   |
| [PATCH `/channels/:channel`](patch-channel.md)                                 | Change a thread's name, archived state, or locked state. |
