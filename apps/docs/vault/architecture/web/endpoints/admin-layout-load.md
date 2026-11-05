---
title: 'Admin layout'
description: 'The load every admin page shares. Sends people without staff permissions to /agents.'
---

Admin pages, such as `/admin/health`, use the [shared signed-in load](owner-layout-load.md) to return `{ person, standing }`.
Without a session, that load redirects `303` to sign-in.
If `standing.permissions` is empty, the admin layout redirects `307` to `/agents` instead.

Passing the layout check does not grant every admin permission.
The relay checks standing again for each admin API call and enforces any permission that route requires.

[Layout](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/+layout.server.ts#L6) · [Relay permission checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/shared.ts#L110)
