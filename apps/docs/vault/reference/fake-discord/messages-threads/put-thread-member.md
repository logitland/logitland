---
title: 'PUT /channels/:channel/thread-members/:user'
description: Fake Discord bot REST route that adds a guild member to a thread.
---

[Fake Discord](../index.md) / [Messages and threads](../messages-threads.md)

Adds a guild member to a thread. Route name `channel.thread_members.add`.
[`DELETE` on the same path](delete-thread-member.md) removes them.

## Request

- Path: `/api/v10/channels/:channel/thread-members/:user`. `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameters: required thread ID `:channel` and guild member user ID `:user`.
- Body: none.

```sh
curl -X PUT http://127.0.0.1:8790/api/v10/channels/100000000000000060/thread-members/100000000000000030 \
  -H 'Authorization: Bot fake-local'
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.
Threads receive generated IDs. Replace the thread ID with one returned by an earlier request.
The example member comes from [`POST /_fake/members`](../control-seeding/post-members.md) with an explicit ID.

## Response

`204` without a body. The thread's `member_count` updates.

## Errors

- `401/0`: missing or wrong bot token.
- `404/10003`: unknown channel.
- `400/50024`: the channel is not a thread.
- `403/50013`: the bot lacks Send Messages in Threads.
- `400/50083`: the thread is archived.
- `404/10007`: the user is not a member of the thread's guild.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

Sources: [channel.thread_members.add](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L426),
[thread membership](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L586).
