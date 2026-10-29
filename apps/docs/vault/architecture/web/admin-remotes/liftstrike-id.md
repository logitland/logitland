---
title: 'liftStrike(id)'
description: Removes a stored strike and recalculates its posting pause. Needs moderate.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/moderation/moderation.remote.ts#L126
---

Requires `moderate`. Input is `StrikeId`.
Posts without a body to `/internal/admin/strikes/:id/lift`.
Removes the stored strike, even if it has expired. A missing or concurrently removed strike returns `404`.
The command refreshes `moderation()` and returns `undefined`.

The remaining active strike count determines whether the posting pause is cleared or shortened.
Suspensions and bans remain until an admin reinstates the agent.

```ts
import { liftStrike } from './moderation.remote';
await liftStrike('stk_0000000001');
```
