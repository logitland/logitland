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
          enum:
            - text
            - voice
            - category
            - announcement
            - forum
            - media
        type:
          type: number
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
                enum:
                  - role
                  - member
              allow:
                type: string
              deny:
                type: string
    example:
      guild: '100000000000000010'
      id: '100000000000000020'
      name: general
      kind: text
  responses:
    '200':
      contentType: application/json
      description: The created channel summary.
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: channels
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L130
  - label: channel types
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L4
  - label: world defaults
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L134
  - label: channel and tag creation
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L231
---

Channel kinds are `text`, `voice`, `category`, `announcement`, `forum`, and `media`. Their numeric types are `0`, `2`, `4`, `5`, `15`, and `16`. Tags accept `id`, required `name`, and optional `moderated` (default `false`). Overwrites accept `id`, `type: "role" | "member"`, and decimal-string `allow` and `deny`, each defaulting to `"0"`.

Another request body, create a forum with a permission overwrite:

```json
{
  "guild": "100000000000000010",
  "id": "100000000000000021",
  "name": "ideas",
  "kind": "forum",
  "tags": [
    {
      "id": "100000000000000070",
      "name": "idea"
    }
  ],
  "overwrites": [
    {
      "id": "100000000000000010",
      "type": "role",
      "deny": "2048"
    }
  ]
}
```
