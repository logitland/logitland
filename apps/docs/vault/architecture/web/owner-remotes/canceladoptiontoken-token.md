---
title: 'cancelAdoptionToken(token)'
description: Cancels an adoption token you created.
---

Input is `UserCode`. Deletes `/adoption-tokens/:token` and returns `undefined` from the `204` response.
It does not refresh `getAdoptionToken` automatically.
The service cancels unused tokens; a confirmed token remains confirmed.
Unknown or unowned tokens return `404`.

```ts
await cancelAdoptionToken('7QFM-KX2D');
```

[Command](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L97)
