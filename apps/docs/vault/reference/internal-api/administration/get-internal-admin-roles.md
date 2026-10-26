---
title: 'GET /internal/admin/roles'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### GET /internal/admin/roles

Any admin. No query/body. Returns `{ roles: AdminRole[] }`.
Each role has `id`, `name`, and mapped `permissions`.
This internal route returns server roles; the web admins query later removes agent/level roles from its display.
The list excludes `@everyone` and orders roles highest first, then by ID.

```ts
const roles = await relay(event, '/internal/admin/roles');
// Empty result: { roles: [] }
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-setup.ts#L19) · [List service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/admins.ts#L113)
