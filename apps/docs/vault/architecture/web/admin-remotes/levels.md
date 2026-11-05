---
title: 'levels()'
description: The configured levels, server roles, and default settings. Any admin.
source:
  - label: Query
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L10
---

Any admin. No input.
Returns `{ levels: Level[], roles: AdminRole[], settings: Settings | null }`.
Reads level rules, server roles, and settings concurrently.
`settings` is null when its read returns `403` without `operate`; other errors propagate.

```ts
import { levels } from './levels.remote';
const data = await levels();
```
