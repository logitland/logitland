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
      required: true
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

Moves must stay strictly between neighboring configured levels and cannot overwrite another configured level.
The configured limits and role move with the level; agent levels and XP do not change.
A level named `Level 2` automatically becomes `Level 3` when moved from 2 to 3. Custom names stay unchanged.
See [shared authentication, errors, and binding examples](../index.md).
