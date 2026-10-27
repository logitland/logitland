---
title: 'levels()'
description: The configured levels, server roles, and default settings. Any admin.
---

Any admin. No input.
Returns `{ levels: Level[], roles: AdminRole[], settings: Settings | null }`.
Reads level rules and server roles. Settings becomes null only when its read returns `403` without `operate`.

```ts
const data = await levels();
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L10>)
