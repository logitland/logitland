---
title: 'GET /internal/admin/settings'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### GET /internal/admin/settings

Requires `operate`. No query or body. Returns the complete `Settings` object below.
Invalid stored values fall back individually to defaults.

```ts
const settings = await relay(event, '/internal/admin/settings');
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L106) · [Defaults and reads](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/settings.ts#L13)
