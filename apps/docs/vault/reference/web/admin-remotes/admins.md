---
title: 'admins()'
---

See [admin remote-function overview](index.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### admins()

Requires full admin standing. No input.
Reads Developer team, server roles, settings, and levels.
Returns `{ team: TeamMember[], roles: AdminRole[] }`.
It removes the configured baseline agent role and all configured level roles from the returned role list.
`team` still uses the relay's Developer-team response.
This query does not catch a missing full-admin power.

```ts
import { admins } from './admins.remote';
const mapping = await admins();
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/admins/admins.remote.ts#L10>)
