---
title: 'saveLevel({ level, update })'
description: Saves one configured level's name, role, limits, and permissions. Needs levels.
---

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
