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
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L426
---

`interactions_endpoint_url` sets the endpoint receiving simulated interactions; `null` or an empty value clears it. `team` is an array of developer user IDs; `null` clears the team. `messageContent` accepts `limited`, `full`, or `off`, setting flags to `524288`, `262144`, or `0`. The returned application fields differ from the expanded object at `GET /api/v10/applications/@me`.
