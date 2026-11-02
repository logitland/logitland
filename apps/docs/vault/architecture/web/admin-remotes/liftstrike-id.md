---
title: 'liftStrike(id)'
description: Lifts an active strike. Needs moderate.
---

Input is `StrikeId`.
Posts without a body to `/internal/admin/strikes/:id/lift`.
A strike the service cannot remove returns `404`.

```ts
await liftStrike('stk_0000000001');
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/moderation/moderation.remote.ts#L147>)
