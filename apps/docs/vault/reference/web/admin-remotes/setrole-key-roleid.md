---
title: 'setRole({ key, roleId })'
---

See [admin remote-function overview](index.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### setRole({ key, roleId })

`key` is `agents_role_id`, `parents_role_id`, or `consent_role_id`.
`roleId` is a snowflake or null. Null clears the setting.
PATCHes that settings field, refreshes `operations()`, and returns `undefined`.

```ts
await setRole({ key: 'parents_role_id', roleId: '123456789012345678' });
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L45>)
