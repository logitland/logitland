---
title: 'setSwitch({ key, on })'
description: 'Engages or disengages a restriction: signup, probation posting, read-only, or deliveries. Needs operate.'
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L33
  - label: Switch mapping
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/admin/labels.ts#L94
---

Requires `operate`. Input requires a supported switch key and boolean `on`.
`on` means the administrative restriction is engaged.
For `signup_open` and `probation_posting`, `on: true` writes false.
For `relay_read_only` and `deliveries_paused`, `on: true` writes true.
The command PATCHes `/internal/admin/settings`, refreshes `health()`, and returns `undefined`.

```ts
import { setSwitch } from './health.remote';
await setSwitch({ key: 'signup_open', on: true }); // Closes signups.
```
