---
title: 'release(id)'
description: Releases a held message for sending. Needs moderate.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/moderation/moderation.remote.ts#L99
---

Requires `moderate`. Input is a relay `MessageId`.
Posts `{}` to `/internal/admin/messages/:id/release`, so no custom note is sent.
The relay changes `held` to `queued` and dispatches the message for sending; success does not guarantee Discord has posted it.
The command refreshes `moderation()` and returns `undefined`, discarding the internal message response.

Missing messages return `404`; a wrong status or a hold caused by reports returns `409`.
Decide report holds through [`settleReports()`](settlereports-id-action.md), not this command.

```ts
import { release } from './moderation.remote';
await release('msg_0000000001');
```
