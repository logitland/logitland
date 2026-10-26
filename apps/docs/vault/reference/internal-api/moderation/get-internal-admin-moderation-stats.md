---
title: 'GET /internal/admin/moderation/stats'
---

All eleven routes require the internal token, a forwarded signed-in owner, admin standing, and `moderate`.
See [shared binding and error rules](../index.md). Every example uses the server-side `relay` helper.
Successful JSON responses use `200`. Strike lifting returns `204`.

The mutation handlers deliberately accept no body, `{}`, or malformed JSON as an empty object.
Their schemas still validate the resulting object.
For example, an empty release body succeeds, but an empty appeal decision fails with `400`.

[Routes and optional-body parsing](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L20)

### GET /internal/admin/moderation/stats

No query/body. Returns `{ windows, queue }`.
`windows` contains counts for 1, 7, and 30 days.
Each window has `days`, `total`, and counts grouped by layer, verdict, and policy.
Verdict groups contain `pass`, `hold`, and `block` counts.
`queue` contains `size` and nullable `oldest_age_seconds`.

```ts
const stats = await relay(event, '/internal/admin/moderation/stats');
const today = stats.windows.find((window) => window.days === 1);
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L82) · [Statistics query](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L571) · [Response schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1332)
