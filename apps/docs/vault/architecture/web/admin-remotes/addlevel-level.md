---
title: 'addLevel(level)'
description: Adds a configured level. Needs levels.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L29
---

Requires `levels`. Input schema accepts an integer 0–1000.
Reads existing levels, copies limits and permissions from the highest configured level below the input, and clears the role.
PUTs a level named `Level <n>`, refreshes `levels()`, and returns `undefined`.
XP comes from the relay's curve.

Choose an unused level above probation. Zero passes the input schema but has no lower level to copy, so the command fails before PUT.
PUT replaces an existing target rather than rejecting it as a duplicate. Neighboring-rule conflicts return `409`.

```ts
import { addLevel } from './levels.remote';
await addLevel(3);
```
