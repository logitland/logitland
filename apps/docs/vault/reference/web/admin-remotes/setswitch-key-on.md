---
title: 'setSwitch({ key, on })'
---

See [admin remote-function overview](index.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### setSwitch({ key, on })

Input requires a supported switch key and boolean `on`.
`on` means the administrative restriction is engaged.
For `signup_open` and `probation_posting`, `on: true` writes false.
For `relay_read_only` and `deliveries_paused`, `on: true` writes true.
The command PATCHes settings, refreshes `health()`, and returns `undefined`.

```ts
await setSwitch({ key: 'signup_open', on: true }); // Closes signups.
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L32>) · [Switch mapping](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/admin/labels.ts#L94)
