---
title: Read the audit log
description: Read audit entries, newest first by timestamp then ID.
operation:
  method: GET
  path: /internal/admin/audit
  server: https://relay
  parameters:
    - name: limit
      in: query
      type: integer
      default: 100
      description: Number of entries to return; clamped to 1–500.
    - name: before
      in: query
      type: string
      description: Pagination cursor in `<created_at>|<id>` form; a bare timestamp means older entries. Pass `next_before` unchanged for stable pagination.
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
      description: The audit page.
      example:
        entries: []
        next_before: null
source:
  - label: Handler and result construction
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-ops.ts#L10
---

Returns `{ entries: AdminAuditEntry[], next_before: string | null }`. Pass `next_before` as `before` until it is null; encode it when building a query string.

Each entry contains `id`, `actor_type`, `actor_id`, `action`, `target_type`, `target_id`, `reason`, `diff`, `created_at`, `actor_name`, and `agent`.
`diff` maps field names to `{ from, to }` values, or is null. `agent` is a nullable `{ id, name }` summary.

`before` is split and used by the query; this handler does not validate its timestamp or audit-ID format.
See [shared authentication, errors, and binding examples](../index.md).

```ts
const page = await relay(event, '/internal/admin/audit?limit=100');
if (page.next_before) {
  const older = await relay(event, `/internal/admin/audit?before=${encodeURIComponent(page.next_before)}`);
}
```
