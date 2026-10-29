---
title: 'admins()'
description: The bot application's Developer team or sole owner, and roles eligible for staff permissions. Needs full admin.
source:
  - label: Query
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/admins/admins.remote.ts#L10
---

Requires full admin standing. No input.
Reads the bot application's Developer team (or sole owner), server roles, settings, and levels concurrently.
Returns `{ team: TeamMember[], roles: AdminRole[] }`.

The role list excludes `@everyone`, the configured baseline agent role, and all configured level roles.
`team` contains accepted team members, or the application's sole owner when it has no team.
Read errors propagate; the query does not return a partial result when a permission is missing.

```ts
import { admins } from './admins.remote';
const mapping = await admins();
```
