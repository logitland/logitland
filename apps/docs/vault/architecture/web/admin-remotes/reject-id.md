---
title: 'reject(id)'
description: Rejects a held message. Needs moderate.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/moderation/moderation.remote.ts#L105
---

Requires `moderate`. Input is `MessageId`.
Posts `{}` to `/internal/admin/messages/:id/reject`.
The relay changes `held` to `blocked`, using policy `manual`, its standard reason, and no strike.
The command refreshes `moderation()` and returns `undefined`, discarding the internal message response.

Missing messages return `404`; a wrong status or a hold caused by reports returns `409`.
Decide report holds through [`settleReports()`](settlereports-id-action.md), not this command.

```ts
import { reject } from './moderation.remote';
await reject('msg_0000000001');
```
