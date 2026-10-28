---
title: List configured levels
description: List configured levels in ascending order.
operation:
  method: GET
  path: /internal/admin/levels
  server: https://relay
  parameters:
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs at least one admin permission.
  responses:
    '200':
      description: The configured levels, ascending by level.
      schema:
        type: object
        properties:
          levels:
            type: array
            items:
              type: object
              properties:
                level:
                  type: integer
                  minimum: 0
                  maximum: 1000
                name:
                  type: string
                  minLength: 1
                  maxLength: 40
                xp:
                  type: integer
                  minimum: 0
                  description: Computed as `round(250 × level²)`.
                role_id:
                  type:
                    - string
                    - 'null'
                  pattern: ^\d{17,20}$
                limits:
                  type: object
                  properties:
                    posts_per_minute:
                      type: integer
                      minimum: 0
                      maximum: 1000
                    posts_per_day:
                      type: integer
                      minimum: 0
                      maximum: 100000
                    subscriptions:
                      type: integer
                      minimum: 0
                      maximum: 1000
                    reads_per_minute:
                      type: integer
                      minimum: 0
                      maximum: 10000
                    private_conversations:
                      type: integer
                      minimum: 0
                      maximum: 100
                  required:
                    - posts_per_minute
                    - posts_per_day
                    - subscriptions
                    - reads_per_minute
                    - private_conversations
                permissions:
                  type: array
                  items:
                    type: string
                    enum:
                      - reports
                      - avatar
                      - private_conversations
              required:
                - level
                - name
                - xp
                - role_id
                - limits
                - permissions
        required:
          - levels
      example:
        levels:
          - level: 0
            name: Probation
            xp: 0
            role_id: null
            limits:
              posts_per_minute: 2
              posts_per_day: 50
              subscriptions: 3
              reads_per_minute: 10
              private_conversations: 0
            permissions: []
          - level: 2
            name: Level 2
            xp: 1000
            role_id: null
            limits:
              posts_per_minute: 10
              posts_per_day: 200
              subscriptions: 20
              reads_per_minute: 120
              private_conversations: 2
            permissions:
              - reports
              - avatar
              - private_conversations
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L86
---

## Levels

Any admin may list levels. There is no query or body.
The response is `{ levels: Level[] }`, ascending by level.
`Level` contains `level`, `name`, computed `xp`, nullable Discord `role_id`, `limits`, and `permissions`. Its level number ranges from 0 to 1000.
See [shared authentication, errors, and binding examples](../index.md).

```ts
await relay(event, '/internal/admin/levels');
```
