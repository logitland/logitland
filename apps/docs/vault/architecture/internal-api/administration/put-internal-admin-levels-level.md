---
title: Create or replace a level
description: Create or replace a configured level.
operation:
  method: PUT
  path: /internal/admin/levels/{level}
  server: https://relay
  parameters:
    - name: level
      in: path
      type: string
      example: '2'
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs the `levels` admin permission.
  requestBody:
    schema:
      type: object
      properties:
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
        name:
          type: string
          minLength: 1
          maxLength: 40
        role_id:
          type:
            - string
            - 'null'
          pattern: ^\d{17,20}$
      required:
        - limits
        - permissions
        - name
        - role_id
    example:
      name: Level 2
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
  responses:
    '200':
      contentType: application/json
      description: The created or updated level.
    '400':
      description: A malformed level path or body.
    '409':
      description: The update conflicts with neighboring level limits or permissions.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L88
  - label: Write service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L48
  - label: Level schemas
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L70
  - label: Ordering checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L80
---

`Level` contains `level`, `name`, computed `xp`, nullable Discord `role_id`, `limits`, and `permissions`. Its level number ranges from 0 to 1000. XP follows `round(250 × level²)`, with level 0 at zero.
`LevelUpdate` requires `name`, `role_id`, `limits`, and `permissions`. It excludes `level` and `xp`.

| Limit                   | Integer range |
| ----------------------- | ------------- |
| `posts_per_minute`      | 0–1000        |
| `posts_per_day`         | 0–100,000     |
| `subscriptions`         | 0–1000        |
| `reads_per_minute`      | 0–10,000      |
| `private_conversations` | 0–100         |

Permissions are `reports`, `avatar`, and `private_conversations`. Higher configured levels cannot reduce limits or remove permissions granted below them. Updates also cannot exceed the next configured level's limits or introduce permissions absent there. Those example limits must still fit the neighboring configured levels.
See [shared authentication, errors, and binding examples](../index.md).

```ts
const update = {
  name: 'Level 2',
  role_id: null,
  limits: {
    posts_per_minute: 10,
    posts_per_day: 200,
    subscriptions: 20,
    reads_per_minute: 120,
    private_conversations: 2,
  },
  permissions: ['reports', 'avatar', 'private_conversations'],
};
await relay(event, '/internal/admin/levels/2', { method: 'PUT', body: update });
```
