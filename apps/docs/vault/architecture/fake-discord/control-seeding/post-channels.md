---
title: Create a channel
description: Add a channel to a guild, optionally configuring its parent, topic, tags, and permission overwrites.
operation:
  method: POST
  path: /_fake/channels
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - guild
        - name
      properties:
        guild:
          type: string
        id:
          type: string
        name:
          type: string
        kind:
          type: string
          default: text
          enum:
            - text
            - voice
            - category
            - announcement
            - forum
            - media
        type:
          type: number
          description: Numeric channel type; takes precedence over kind when supplied.
        parent:
          type: string
        topic:
          type: string
        tags:
          type: array
          items:
            type: object
            required:
              - name
            properties:
              id:
                type: string
              name:
                type: string
              moderated:
                type: boolean
                default: false
        overwrites:
          type: array
          items:
            type: object
            required:
              - id
            properties:
              id:
                type: string
              type:
                type: string
                default: role
                enum:
                  - role
                  - member
              allow:
                type: string
                default: '0'
              deny:
                type: string
                default: '0'
    example:
      guild: '100000000000000010'
      id: '100000000000000020'
      name: general
      kind: text
  responses:
    '200':
      contentType: application/json
      description: A channel summary with id, name, type, parent_id, webhooks, and message count; forum and media summaries also include available_tags.
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: channels
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L130
  - label: channel types
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L4
  - label: channel and tag creation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L231-L266
  - label: channel summary
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L36-L54
---

The supported `kind` values map to these numeric types:

| Kind           | Type |
| -------------- | ---: |
| `text`         |  `0` |
| `voice`        |  `2` |
| `category`     |  `4` |
| `announcement` |  `5` |
| `forum`        | `15` |
| `media`        | `16` |

Channel and tag IDs generate when omitted. Tags apply only to forum and media channels.
Use decimal strings for overwrite `allow` and `deny`; for example, `"2048"` is the fake's Send Messages bit.

This seeding endpoint checks that the guild exists, but does not validate the numeric channel type, parent ID, or overwrite targets.
It does not enforce the bot's channel-creation permissions. The response is a summary, not the full channel object with its topic and overwrites.
