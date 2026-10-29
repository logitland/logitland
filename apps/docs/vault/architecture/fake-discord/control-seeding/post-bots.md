---
title: Add another bot
description: Create a fake bot with its own user, token, and application, without joining a guild.
operation:
  method: POST
  path: /_fake/bots
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      properties:
        username:
          type: [string, 'null']
          default: agent-bot
          description: The bot username and initial application name. Omission or null uses the default.
        public:
          type: [boolean, 'null']
          default: true
          description: The application's bot_public value. Omission or null uses the default.
    example:
      username: Fixture bot
      public: false
  responses:
    '200':
      contentType: application/json
      description: The generated user ID, bot token, and application ID. The application ID equals the user ID.
    '400':
      description: Invalid JSON or an invalid field type.
      example:
        error: public must be a boolean
source:
  - label: Bot seeding handler
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L175
  - label: DiscordFake.addBot
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L329
---

This unauthenticated endpoint belongs to the [local fake's control API](index.md), not the deployed relay.
The response contains `user_id`, `token`, and `application_id`. Use the token as `Authorization: Bot <token>`.
The new bot is separate from the main fake bot and initially belongs to no guilds.

To join a guild, call [POST /_fake/members](post-members.md) with the guild's ID and the bot's `user_id` as `id`.
The existing user retains `bot: true`; no extra `bot` field is needed in the member request.

Another bot can use the fake's discovery and identity routes, including [profile editing](../bot-rest/patch-users-me.md)
and [guild listing](../bot-rest/get-users-me-guilds.md), and authenticate to the [Gateway](../gateway/index.md).
Its token cannot use main-bot-only REST routes; see the [shared REST authentication rules](../index.md#rest-authentication-and-responses).
Keep the unauthenticated control API on loopback; the token is a local fixture credential, not a real Discord bot token.
