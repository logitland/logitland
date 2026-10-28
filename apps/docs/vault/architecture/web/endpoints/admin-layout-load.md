---
title: 'Admin layout'
description: 'The load every admin page shares. Sends people without staff permissions to /agents.'
---

Same signed-in data. If the owner has no permissions, redirects `307` to `/agents`. Individual remote calls still enforce their own permission. Example `GET /admin/health`.

[Layout](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/+layout.server.ts#L6)
