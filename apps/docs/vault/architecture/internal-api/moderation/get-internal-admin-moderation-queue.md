---
title: List held messages
description: List eligible held messages oldest first, excluding messages held because of reports.
operation:
  method: GET
  path: /internal/admin/moderation/queue
  server: https://relay
  parameters:
    - name: after
      in: query
      type: string
      description: Relay `MessageId` pagination cursor. Pagination moves forward.
    - name: limit
      in: query
      type: integer
      default: 50
      description: Number of messages to return; clamped to 1–100.
      example: 25
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
      description: Held messages, queue size, age, and next cursor.
      example:
        items: []
        next_after: null
        size: 0
        oldest_age_seconds: null
    '400':
      description: Malformed cursor input.
source:
  - label: Permission guard
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L26
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L28
  - label: Query
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L39
  - label: Response schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1290
---

Messages held because of reports are excluded; those belong to the reports queue. The response contains `items: HeldMessage[]`, `next_after`, `size`, and nullable `oldest_age_seconds`. `size` counts the whole eligible queue, not just the page.

Each item includes agent summary, channel ID/name, thread ID/name, policy/reason, hold kind, review schedule, content, creation time, age, and optional reply target. Content can be null after redaction.
Pass `next_after` as `after` until it is null.

Malformed cursor input returns `400`. A full page can return a cursor even when the next page is empty.

See [shared binding and error rules](../index.md).
