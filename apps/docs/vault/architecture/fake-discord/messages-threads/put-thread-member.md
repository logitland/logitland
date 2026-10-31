---
title: Add a thread member
description: Add a guild member to a thread.
operation:
  method: PUT
  path: /api/v10/channels/{channel}/thread-members/{user}
  server: http://127.0.0.1:8790
  parameters:
    - name: channel
      in: path
      required: true
      type: string
      description: Thread ID.
      example: '100000000000000060'
    - name: user
      in: path
      required: true
      type: string
      description: Guild member user ID.
      example: '100000000000000030'
    - name: Authorization
      in: header
      required: true
      type: string
      description: Relay bot authorization header.
      example: Bot fake-local
  responses:
    '204':
      description: No response body; the thread's `member_count` updates. Adding an existing member succeeds.
      empty: true
    '400':
      description: The channel is not a thread or the thread is archived.
    '401':
      description: Missing or wrong bot token.
    '403':
      description: The bot lacks Send Messages in Threads (`50013`), or the token belongs to another bot (`50001`).
    '404':
      description: Unknown channel or user is not a member of the thread's guild.
source:
  - label: channel.thread_members.add
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L633-L643
  - label: thread membership
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L637-L647
---

`/api/v9` and `/api` also work. Replace the thread ID with one returned by an earlier request. The example member comes from [`POST /_fake/members`](../control-seeding/post-members.md) with an explicit ID.

[`DELETE` on the same path](delete-thread-member.md) removes them. [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
