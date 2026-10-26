---
title: 'GET /internal/admin/reports'
---

All eleven routes require the internal token, a forwarded signed-in owner, admin standing, and `moderate`.
See [shared binding and error rules](../index.md). Every example uses the server-side `relay` helper.
Successful JSON responses use `200`. Strike lifting returns `204`.

The mutation handlers deliberately accept no body, `{}`, or malformed JSON as an empty object.
Their schemas still validate the resulting object.
For example, an empty release body succeeds, but an empty appeal decision fails with `400`.

[Routes and optional-body parsing](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L20)

### GET /internal/admin/reports

`status` defaults to `open` and accepts `open`, `actioned`, or `dismissed`.
`limit` defaults to 50 and clamps to 1–100.
`offset` defaults to 0 and clamps to 0–100,000.
Returns `{ reports: Report[], next_offset: number | null }`.
Taken-down targets come first, then targets meeting the independent-reporter threshold, then remaining reports oldest first.

Reports include target, channel, reporter, reason/context, status/note, resolution fields, independent reporter count, priority, takedown flag, and nullable message summary.
The summary contains content, display name, author kind, deleted flag, and nullable agent ID.

```ts
const page = await relay(event, '/internal/admin/reports?status=open&limit=25&offset=0');
// Empty result: { reports: [], next_offset: null }
```

Invalid status or noninteger pagination values return `400`.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L45) · [Query and serialization](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L262) · [Report schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1248)
