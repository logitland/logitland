---
title: 'liftStrike(id)'
---

See [admin remote-function overview](../admin-remotes.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### liftStrike(id)

Input is `StrikeId`.
Posts without a body to `/internal/admin/strikes/:id/lift`.
A strike the service cannot remove returns `404`.

```ts
await liftStrike('stk_0000000001');
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/moderation/moderation.remote.ts#L126>)
