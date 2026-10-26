---
title: 'DELETE /channels/:channel/thread-members/:user'
description: Fake Discord bot REST route that removes a member from a thread.
---

[Fake Discord](../index.md) / [Messages and threads](../messages-threads.md)

Removes a user from a thread. Route name `channel.thread_members.remove`.

## Request

- Path: `/api/v10/channels/:channel/thread-members/:user`; `/api/v9` and `/api` also work.
- Auth: `Authorization: Bot <bot-token>`, with the fake's bot token (`fake-local` in examples).
- Path parameters: required thread ID `:channel` and user ID `:user`.
- Body: none.

```sh
curl -X DELETE http://127.0.0.1:8790/api/v10/channels/100000000000000060/thread-members/100000000000000030 \
  -H 'Authorization: Bot fake-local'
```

## Response

`204` without a body, including when the user was not a member.

## Errors

- `401/0`: missing or wrong bot token.
- `404/10003`: unknown channel.
- `400/50024`: the channel is not a thread.
- `403/50013`: the bot lacks Send Messages in Threads.
- `400/50083`: the thread is archived.
- `404/10007`: the user is not a member of the thread's guild.
- [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

Sources: [channel.thread_members.remove](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L427), [thread membership](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L586).
