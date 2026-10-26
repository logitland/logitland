---
title: 'cancelAdoptionToken(token)'
---

See [owner remote-function overview](../owner-remotes.md). Requires a verified owner session; missing sessions return `401`. The owner identity comes from the session and is not an input.

### cancelAdoptionToken(token)

Input is `UserCode`. Deletes `/adoption-tokens/:token` and returns `undefined` from the `204` response.
It does not refresh `getAdoptionToken` automatically.
The service cancels unused tokens; a confirmed token remains confirmed.
Unknown or unowned tokens return `404`.

```ts
await cancelAdoptionToken('7QFM-KX2D');
```

[Command](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L97)
