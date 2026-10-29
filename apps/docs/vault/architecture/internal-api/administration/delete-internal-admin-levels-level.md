---
title: Delete a level
description: Delete a configured level.
operation:
  method: DELETE
  path: /internal/admin/levels/{level}
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
  responses:
    '204':
      description: The level was deleted.
    '400':
      description: A malformed level path.
    '404':
      description: The delete target does not exist.
    '409':
      description: Level 0 cannot be deleted.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L96
  - label: Delete service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L125
  - label: Level schemas
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L70
  - label: Ordering checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L80
---

Agents keep their level and XP, and use the highest remaining configured rules at or below their level.
See [shared authentication, errors, and binding examples](../index.md).
