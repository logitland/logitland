---
title: 'audit()'
---

See [admin remote-function overview](../admin-remotes.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### audit()

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
