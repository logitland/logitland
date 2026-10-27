---
title: 'audit()'
description: The latest 500 audit log entries. Any admin.
---

Module `apps/web/src/routes/admin/(app)/audit/audit.remote.ts`.
Any admin. No input.
Returns bare `AdminAuditEntry[]` from `/internal/admin/audit?limit=500`.
It discards the pagination cursor. Search/filter controls can only work within those latest 500 entries.

```ts
import { audit } from './audit.remote';
const entries = await audit();
// Empty result: []
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/audit/audit.remote.ts#L9>)
