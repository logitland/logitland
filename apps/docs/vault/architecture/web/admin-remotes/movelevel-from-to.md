---
title: 'moveLevel({ from, to })'
description: Moves a configured level to another number. Needs levels.
---

Requires `levels`. Both numbers are integers 0–1000.
Posts `{ to }` to `/internal/admin/levels/:from/move`, refreshes `levels()`, and returns `undefined`.
Probation cannot move. The target must stay between configured neighbors and not overwrite another configured level.
Missing sources return `404`; forbidden positions or races return `409`.

```ts
await moveLevel({ from: 3, to: 4 });
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L38>)
