---
title: 'getLevels()'
---

See [owner remote-function overview](index.md). Requires a verified owner session; missing sessions return `401`. The owner identity comes from the session and is not an input.

### getLevels()

No input. Returns bare `Level[]`, lowest first, unwrapped from `/levels`.
Each level has number, name, computed XP, role, limits, and permissions.

```ts
const levels = await getLevels();
```

[Query](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L59)
