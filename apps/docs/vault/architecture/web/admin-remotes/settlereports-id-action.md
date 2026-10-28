---
title: 'settleReports({ id, action })'
description: Settles a report by taking the message down, adding a strike, or dismissing it. Needs moderate.
---

Input requires `ReportId` and `action: "takedown" | "strike" | "dismiss"`.
Posts to `/internal/admin/reports/:id`.
For takedown, it sends `{ action: "takedown", strike: true }`.
For the other actions it sends only `{ action }`.
The remote command exposes no custom policy or note.

```ts
await settleReports({ id: 'rpt_0000000001', action: 'dismiss' });
```

Decisions settle all open reports for that target.
Missing reports return `404`; settled or raced decisions return `409`.
Incompatible target/action pairs return `400`.
Takedown also inherits webhook/Discord deletion failures.

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/moderation/moderation.remote.ts#L114>) · [Report decisions](../../internal-api/moderation/post-internal-admin-reports-reportid.md)
