---
title: 'release(id)'
description: Releases a held message for sending. Needs moderate.
---

Input is relay `MessageId`.
Posts `{}` to `/internal/admin/messages/:id/release`, so no custom note is sent.
Only ordinary held messages can be released here.
Missing messages return `404`; wrong status or reports holds return `409`.

```ts
await release('msg_0000000001');
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/moderation/moderation.remote.ts#L120>)
