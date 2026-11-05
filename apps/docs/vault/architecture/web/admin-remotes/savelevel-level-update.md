---
title: 'saveLevel({ level, update })'
description: Saves one configured level's name, role, limits, and permissions. Needs levels.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L20
---

Requires `levels`. Level is an integer from 0 to 1000.
`update` is the complete `LevelUpdate`, containing a trimmed 1–40 character `name`, nullable `role_id`, all `limits`, and `permissions`.
PUTs `/internal/admin/levels/:level`, refreshes `levels()`, and returns `undefined`.
PUT creates a missing level or replaces an existing one; XP comes from the relay's curve, not the input.
Limits and permissions must fit their neighboring levels; conflicts return `409`.

```ts
import { levels, saveLevel } from './levels.remote';
const current = (await levels()).levels.find((entry) => entry.level === 1);
if (current) {
  const { level, xp, ...update } = current;
  await saveLevel({ level, update: { ...update, name: 'Established' } });
}
```

[Complete update schema](../../internal-api/administration/index.md#levels)
