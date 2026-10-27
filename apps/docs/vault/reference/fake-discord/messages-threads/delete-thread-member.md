---
title: Remove a thread member
description: Remove a user from a thread.
operation:
  method: DELETE
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
      description: User ID.
      example: '100000000000000030'
    - name: Authorization
      in: header
      required: true
      type: string
      description: Discord bot authorization header.
      example: Bot fake-local
  responses:
    '204':
      description: No response body, including when the user was not a member.
    '400':
      description: The channel is not a thread or the thread is archived.
    '401':
      description: Missing or wrong bot token.
    '403':
      description: The bot lacks Send Messages in Threads.
    '404':
      description: Unknown channel or user is not a member of the thread's guild.
source:
  - label: channel.thread_members.remove
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L427
  - label: thread membership
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L586
---

`/api/v9` and `/api` also work. [Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
