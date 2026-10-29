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
      description: Relay bot authorization header.
      example: Bot fake-local
  responses:
    '204':
      description: No response body, including when the user was not a member.
      empty: true
    '400':
      description: The channel is not a thread or the thread is archived.
    '401':
      description: Missing or wrong bot token.
    '403':
      description: The bot lacks Send Messages in Threads (`50013`), or the token belongs to another bot (`50001`).
    '404':
      description: Unknown channel (`10003`).
source:
  - label: channel.thread_members.remove
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L494-L504
  - label: thread membership
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L590-L600
---

`/api/v9` and `/api` also work. Unlike adding a member, removal does not check guild membership. Removing an absent user still succeeds and updates `member_count`.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
