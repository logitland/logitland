---
title: Edit a bot user
description: Change the authenticated fake bot's username or avatar.
operation:
  method: PATCH
  path: /api/v10/users/@me
  server: http://127.0.0.1:8790
  parameters:
    - name: Authorization
      in: header
      required: true
      type: string
      description: The main fake bot token or a token returned by POST /_fake/bots.
      example: Bot fake-local
  requestBody:
    schema:
      type: object
      properties:
        username:
          type: [string, 'null']
          minLength: 2
          maxLength: 32
          description: Omit or send null to keep the current username.
        avatar:
          type: [string, 'null']
          description: A data URI beginning with data:image/png;base64, data:image/jpeg;base64, data:image/gif;base64, or data:image/webp;base64. Null clears the avatar; omission leaves it unchanged.
    example:
      username: Fixture bot
      avatar: null
  responses:
    '200':
      contentType: application/json
      description: 'The updated bot User, with `verified: true`, `mfa_enabled: false`, and `flags: 0`.'
    '400':
      description: Invalid username, avatar, or content type (`50035`); malformed JSON or a non-object body (`50109`).
    '401':
      description: Missing or unknown bot token (`0`).
source:
  - label: users.me.edit
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L323
  - label: Bot token lookup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L338
---

Route name `users.me.edit`. The `/api/v9` and `/api` prefixes also work.
The token selects the bot to update: the main fake bot or a bot created with [POST /_fake/bots](../control-seeding/post-bots.md).

An empty object leaves the profile unchanged. A non-null avatar gets a generated ID in the returned `avatar` field;
the fake checks the data URI prefix but does not decode or validate the image bytes.
Changing `username` does not rename the bot's application.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
The fake does not model Discord's separate limits on profile changes.
