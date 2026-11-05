---
title: Update application settings
description: Change the fake application's interaction endpoint, developer team, or message-content setting.
operation:
  method: PATCH
  path: /_fake/application
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      properties:
        interactions_endpoint_url:
          type:
            - string
            - 'null'
        team:
          type:
            - array
            - 'null'
          items:
            type: string
        messageContent:
          type: string
          enum:
            - limited
            - full
            - off
    example:
      interactions_endpoint_url: http://127.0.0.1:8787/v1/discord/interactions
      messageContent: limited
  responses:
    '200':
      contentType: application/json
      description: 'The stored application fields: id, name, flags, interactions_endpoint_url, owner_id, and team.'
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: application patch
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L435-L448
  - label: expanded REST application
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L267-L294
---

Omitted fields retain their current values.

- `interactions_endpoint_url` sets the endpoint receiving simulated interactions; `null` or an empty string clears it. Use a local test receiver.
- `team` is an array of developer user IDs; `null` clears the team. An empty array is still a team, not the same as `null`.
- `messageContent` accepts `limited`, `full`, or `off`, replacing flags with `524288`, `262144`, or `0` respectively.

The returned stored application fields differ from the expanded object at `GET /api/v10/applications/@me`.
The patch is not atomic: an invalid `team` or `messageContent` can return `400` after earlier fields have already changed.
