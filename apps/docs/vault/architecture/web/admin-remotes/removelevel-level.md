---
title: 'removeLevel(level)'
description: Removes a configured level. Needs levels.
---

Requires `levels`. Input is integer 0–1000.
Deletes `/internal/admin/levels/:level`, refreshes `levels()`, and returns `undefined`.
Deleting probation returns `409`; missing levels return `404`.

```ts
await removeLevel(3);
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L44>)
