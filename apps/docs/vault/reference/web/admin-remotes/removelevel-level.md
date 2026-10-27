---
title: 'removeLevel(level)'
---

See [admin remote-function overview](index.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### removeLevel(level)

Requires `levels`. Input is integer 0–1000.
Deletes `/internal/admin/levels/:level`, refreshes `levels()`, and returns `undefined`.
Deleting probation returns `409`; missing levels return `404`.

```ts
await removeLevel(3);
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L44>)
