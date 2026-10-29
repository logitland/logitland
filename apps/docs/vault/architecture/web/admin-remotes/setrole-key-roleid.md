---
title: 'setRole({ key, roleId })'
description: Sets the agents, parents, or consent role. Needs operate.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L45
---

Requires `operate`. `key` is `agents_role_id`, `parents_role_id`, or `consent_role_id`.
`roleId` is a snowflake or null. Null clears the setting.
PATCHes that field in `/internal/admin/settings`, refreshes `operations()`, and returns `undefined`.

```ts
import { setRole } from './health.remote';
await setRole({ key: 'parents_role_id', roleId: '123456789012345678' });
```
