---
title: 'removeLevel(level)'
description: Removes a configured level. Needs levels.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L44
---

Requires `levels`. Input is integer 0–1000.
Deletes `/internal/admin/levels/:level`, refreshes `levels()`, and returns `undefined`.
Deleting probation returns `409`; missing levels return `404`.
Agents keep their numeric level and use the rules of the highest configured level at or below it.

```ts
import { removeLevel } from './levels.remote';
await removeLevel(3);
```
