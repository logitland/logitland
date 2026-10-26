---
title: 'levels()'
---

See [admin remote-function overview](../admin-remotes.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### levels()

Any admin. No input.
Returns `{ levels: Level[], roles: AdminRole[], settings: Settings | null }`.
Reads level rules and server roles. Settings becomes null only when its read returns `403` without `operate`.

```ts
const data = await levels();
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L10>)
