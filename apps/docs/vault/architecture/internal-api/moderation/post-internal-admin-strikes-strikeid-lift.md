---
title: Lift a moderation strike
description: Remove a strike as the current admin.
operation:
  method: POST
  path: /internal/admin/strikes/{strikeId}/lift
  server: https://relay
  parameters:
    - name: strikeId
      in: path
      required: true
      type: string
      example: stk_0000000001
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs the `moderate` admin permission.
  responses:
    '204':
      description: The strike was lifted.
    '404':
      description: The strike could not be removed.
source:
  - label: Permission guard
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L26
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L77
  - label: Strike service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/strikes.ts#L213
---

No request body is required. The strike is lifted with reason `Lifted by an admin`.

The remaining active strike count can shorten or end a posting pause. Suspensions and bans stay until an admin reinstates the agent.
See [shared binding and error rules](../index.md).
