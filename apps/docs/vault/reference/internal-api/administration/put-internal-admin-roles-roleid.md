---
title: 'PUT /internal/admin/roles/:roleId'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### PUT /internal/admin/roles/:roleId

Requires full admin standing. Body is `{ permissions: AdminPermission[] }`.
The array permits at most five entries. The service deduplicates and orders permissions.
An empty list removes the role's admin mapping.
Returns the bare `{ id, name, permissions }` role and audits the change.
Unknown server roles return `404`. Mapping `@everyone` returns `400`.

```ts
const role = await relay(event, '/internal/admin/roles/123456789012345678', {
  method: 'PUT',
  body: { permissions: ['moderate', 'agents'] },
});
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-setup.ts#L21) · [Write service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/admins.ts#L123) · [Schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1369)
