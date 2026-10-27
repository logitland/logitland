---
title: 'addLevel(level)'
description: Adds a configured level. Needs levels.
---

Requires `levels`. Input schema accepts an integer 0–1000.
Reads existing levels, copies limits and permissions from the highest configured level below the input, and clears the role.
PUTs a level named `Level <n>`, refreshes `levels()`, and returns `undefined`.
XP comes from the relay's curve.

```ts
await addLevel(3);
```

The implementation assumes a lower configured level exists.
Use a level above probation; zero passes the input schema but has no lower level to copy.
It calls PUT, so a caller must not assume an existing target is rejected as a duplicate.
Neighboring-rule conflicts still return `409`.

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L29>)
