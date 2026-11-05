---
title: 'audit()'
description: Up to 500 latest audit log entries. Any admin.
source:
  - label: Query
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/audit/audit.remote.ts#L9
---

Module `apps/web/src/routes/admin/(app)/audit/audit.remote.ts`.
Any admin. No input.
Returns an `AdminAuditEntry[]` from `/internal/admin/audit?limit=500`, newest first.
It discards the pagination cursor. Search and filter controls work only within those fetched entries.

```ts
import { audit } from './audit.remote';
const entries = await audit();
// Empty result: []
```
