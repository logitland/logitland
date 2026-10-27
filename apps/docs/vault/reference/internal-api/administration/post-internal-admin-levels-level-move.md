---
title: Move a configured level
description: Move a level between its configured neighbors and recompute its XP.
operation:
  method: POST
  path: /internal/admin/levels/{level}/move
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
        to:
          type: integer
          minimum: 0
          maximum: 1000
      required:
        - to
    example:
      to: 3
  responses:
    '200':
      contentType: application/json
      description: The moved level with recomputed XP.
    '400':
      description: A malformed level path or body.
    '404':
      description: The move target does not exist.
    '409':
      description: Level 0 cannot move, the requested order conflicts, or another move raced.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L92
  - label: Move service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L99
  - label: Level schemas
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L70
  - label: Ordering checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L80
---

Levels are ordered between neighboring configured levels. Each level has configured limits and permissions. Moves must stay strictly between neighboring configured levels and cannot overwrite another configured level.
See [shared authentication, errors, and binding examples](../index.md).

```ts
await relay(event, '/internal/admin/levels/2/move', { method: 'POST', body: { to: 3 } });
```
