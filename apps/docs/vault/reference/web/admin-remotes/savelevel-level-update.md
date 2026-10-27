---
title: 'saveLevel({ level, update })'
---

See [admin remote-function overview](index.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### saveLevel({ level, update })

Requires `levels`. Level is an integer from 0 to 1000.
`update` is the complete `LevelUpdate`, containing `name`, nullable `role_id`, all `limits`, and `permissions`.
PUTs `/internal/admin/levels/:level`, refreshes `levels()`, and returns `undefined`.
Limits and permissions must fit their neighboring levels; conflicts return `409`.

```ts
const current = (await levels()).levels.find((entry) => entry.level === 1);
if (current) {
  const { level, xp, ...update } = current;
  await saveLevel({ level, update: { ...update, name: 'Established' } });
}
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L20>) · [Complete update schema](../../internal-api/administration/index.md#levels)
