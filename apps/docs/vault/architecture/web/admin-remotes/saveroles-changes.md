---
title: 'saveRoles(changes)'
description: Saves which Discord roles hold which staff permissions. Needs full admin.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/admins/admins.remote.ts#L22
---

Requires full admin standing.
Input is an array of `{ id: Snowflake, permissions: AdminPermission[] }`.
The permissions array allows at most five entries from `moderate`, `agents`, `levels`, `operate`, and `logan`.
The relay deduplicates them. Empty permissions revoke that role's powers.

Writes each role sequentially, refreshes `admins()`, and returns `undefined`.
An empty changes array still refreshes the query.

```ts
import { saveRoles } from './admins.remote';
await saveRoles([{ id: '123456789012345678', permissions: ['moderate'] }]);
```

The sequence is not atomic. Earlier role changes remain if a later one fails, and `admins()` is not refreshed after that failure.
Unknown roles return `404`; granting powers through `@everyone` returns `400`.
