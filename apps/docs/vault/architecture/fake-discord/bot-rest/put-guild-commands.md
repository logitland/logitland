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
      description: The relay bot's token configured on the fake.
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
            description: Required for type 1; ignored for types 2 and 3.
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
                  type: number
                  description: The fake checks the range, not whether this is an integer.
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
      description: A non-array body, more than 100 commands, or an invalid type, name, duplicate, description, or option (`50035`); the response names the failing field in `errors`.
    '401':
      description: Missing or wrong bot token (`0`).
    '403':
      description: Another seeded bot's token, or the application ID does not match (`50001`).
    '404':
      description: Unknown guild (`10004`).
source:
  - label: commands.put
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L434
  - label: option validation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L769
---

Route name `commands.put`. The `/api/v9` and `/api` prefixes also work.
The application ID must match the relay bot's application. The fake checks that the guild exists, not that the relay bot belongs to it.
The example application ID comes from `--application-id 100000000000000001`.
The guild comes from [`POST /_fake/guilds`](../control-seeding/post-guilds.md) with an explicit ID.

## Command fields

- Command and option names accept only Unicode letters, numbers, `-`, `_`, and `'`, with 1–32 characters.
  Slash-command names (type `1`) and all option names must be lowercase. Each command's `type`/`name` pair must be unique.
- Type `1` requires a description of 1–100 characters. Types `2` and `3` store an empty description, even when one is supplied.
- Each option requires `type`, `name`, and a description of 1–100 characters. Nested `options` follow the same checks, with at most 25 options per array.
- `default_member_permissions` stores a string, or becomes `null` for an omitted or non-string value.
- `nsfw` is `true` only when set to `true`; `integration_types` and `contexts` both become `[0]`.

Each successful PUT replaces the whole list; send `[]` to clear it.
Repeated PUTs keep the IDs of matching type/name pairs and assign one new shared `version` to all stored commands.
[`GET` on the same path](get-guild-commands.md) returns the stored array.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover JSON bodies, rate-limit headers, and injected failures.
