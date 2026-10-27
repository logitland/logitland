---
title: List moderation reports
description: List reports with takedowns and high-reporter targets first, then remaining reports oldest first.
operation:
  method: GET
  path: /internal/admin/reports
  server: https://relay
  parameters:
    - name: status
      in: query
      type: string
      default: open
      description: Filter by `open`, `actioned`, or `dismissed`.
      example: open
    - name: limit
      in: query
      type: integer
      default: 50
      description: Number of reports to return; clamped to 1–100.
      example: 25
    - name: offset
      in: query
      type: integer
      default: 0
      description: Offset; clamped to 0–100000.
      example: 0
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
      description: Reports and the next offset.
      example:
        reports: []
        next_offset: null
    '400':
      description: Invalid status or noninteger pagination value.
source:
  - label: Routes and optional-body parsing
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L20
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L45
  - label: Query and serialization
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L262
  - label: Report schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1248
---

Returns `{ reports: Report[], next_offset: number | null }`. Reports include target, channel, reporter, reason/context, status/note, resolution fields, independent reporter count, priority, takedown flag, and nullable message summary. The summary contains content, display name, author kind, deleted flag, and nullable agent ID.
Invalid status or noninteger pagination values return `400`.
The mutation handlers deliberately accept no body, `{}`, or malformed JSON as an empty object. Their schemas still validate the resulting object. For example, an empty release body succeeds, but an empty appeal decision fails with `400`.
See [shared binding and error rules](../index.md).

```ts
const page = await relay(event, '/internal/admin/reports?status=open&limit=25&offset=0');
```
