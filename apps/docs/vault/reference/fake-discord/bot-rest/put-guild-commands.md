---
title: Replace guild commands
description: Replace all application commands registered for a guild.
operation:
  method: PUT
  path: /api/v10/applications/{app}/guilds/{guild}/commands
  server: http://127.0.0.1:8790
  parameters:
    - name: app
      in: path
      type: string
      description: The fake application's ID.
      example: '100000000000000001'
    - name: guild
      in: path
      type: string
      description: The guild ID.
      example: '100000000000000010'
    - name: Authorization
      in: header
      required: true
      type: string
      description: The fake bot token.
      example: Bot fake-local
  requestBody:
    schema:
      type: array
      maxItems: 100
      items:
        type: object
        required:
          - name
        properties:
          type:
            type: integer
            enum:
              - 1
              - 2
              - 3
            default: 1
          name:
            type: string
            minLength: 1
            maxLength: 32
          description:
            type: string
            minLength: 1
            maxLength: 100
          options:
            type: array
            maxItems: 25
            items:
              type: object
              required:
                - type
                - name
                - description
              properties:
                type:
                  type: integer
                  minimum: 1
                  maximum: 11
                name:
                  type: string
                  minLength: 1
                  maxLength: 32
                description:
                  type: string
                  minLength: 1
                  maxLength: 100
                options:
                  type: array
                  maxItems: 25
          default_member_permissions:
            type: string
          nsfw:
            type: boolean
            default: false
    example:
      - name: mirror
        description: Manage mirroring
  responses:
    '200':
      contentType: application/json
      description: The stored ApplicationCommand array.
    '400':
      description: A non-array body, more than 100 commands, or an invalid name, duplicate, description, or option (`50035`); the response names the failing field in `errors`.
    '401':
      description: Missing or wrong bot token (`0`).
    '403':
      description: The application ID does not match (`50001`).
    '404':
      description: Unknown guild (`10004`).
source:
  - label: commands.put
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L275
  - label: option validation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L553
---

Route name `commands.put`. The `/api/v9` and `/api` prefixes also work.
The example application ID comes from `--application-id 100000000000000001`.
The guild comes from [`POST /_fake/guilds`](../control-seeding/post-guilds.md) with an explicit ID.

### Command fields

Slash-command names (type `1`) must be lowercase. The pair of `type` and `name` must be unique.
Types `2` and `3` store an empty description, even when one is supplied.
Nested `options` follow the same checks.
`default_member_permissions` stores a string, or defaults to `null`.
`nsfw` is `true` only when set to `true`; `integration_types` and `contexts` both become `[0]`.

Repeated PUTs keep the IDs of matching type/name pairs and assign one new shared `version`.
[`GET` on the same path](get-guild-commands.md) returns the stored array.

- [Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
