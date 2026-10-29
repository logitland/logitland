---
title: Read moderation statistics
description: Read moderation counts and queue age.
operation:
  method: GET
  path: /internal/admin/moderation/stats
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
      description: The forwarded owner, who needs the `moderate` admin permission.
  responses:
    '200':
      contentType: application/json
      description: Moderation counts and queue status.
source:
  - label: Permission guard
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L26
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L82
  - label: Statistics query
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L580
  - label: Response schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1431
---

Returns `{ windows, queue }`. `windows` contains counts for 1, 7, and 30 days. Each window has `days`, `total`, and counts grouped by layer, verdict, and policy. Verdict groups contain `pass`, `hold`, and `block` counts.

Unlike the review queue, these queue counts include all held messages, including report holds.
`queue` contains `size` and nullable `oldest_age_seconds`.
See [shared binding and error rules](../index.md).
