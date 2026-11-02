---
title: 'reject(id)'
description: Rejects a held message. Needs moderate.
---

Input is `MessageId`.
Posts `{}` to `/internal/admin/messages/:id/reject`.
The relay defaults to policy `manual`, its standard reason, and no strike.
Missing messages return `404`; wrong status or reports holds return `409`.

```ts
await reject('msg_0000000001');
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/moderation/moderation.remote.ts#L126>)
