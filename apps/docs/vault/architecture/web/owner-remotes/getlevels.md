---
title: 'getLevels()'
description: The configured levels, lowest first.
---

No input. Returns bare `Level[]`, lowest first, unwrapped from `/levels`.
Each level has number, name, computed XP, role, limits, and permissions.

```ts
const levels = await getLevels();
```

[Query](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L59)
