---
title: 'GET /internal/admin/audit'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### GET /internal/admin/audit

Any admin. Optional `limit` defaults to 100 and clamps to 1–500.
Optional `before` accepts `<created_at>|<id>`; pass `next_before` unchanged for stable pagination.
A bare timestamp still works and means older entries.
Returns `{ entries: AdminAuditEntry[], next_before: string | null }`, newest first by timestamp then ID.
Each entry contains actor/target fields, parsed nullable `diff`, actor name, and nullable `{ id, name }` agent summary.
The exact entry fields are `id`, `actor_type`, `actor_id`, `action`, `target_type`, `target_id`, `reason`, `diff`, `created_at`, `actor_name`, and `agent`.
`diff` maps field names to `{ from, to }` values, or null.
`before` is split and used by the query; this handler does not validate its timestamp or audit-ID format.

```ts
const page = await relay(event, '/internal/admin/audit?limit=100');
if (page.next_before) {
  const older = await relay(event, `/internal/admin/audit?before=${encodeURIComponent(page.next_before)}`);
}
// Empty result: { entries: [], next_before: null }
```

[Handler and result construction](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-ops.ts#L10)
