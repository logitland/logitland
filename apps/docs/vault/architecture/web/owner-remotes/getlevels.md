---
title: 'getLevels()'
description: The configured levels, lowest first.
source:
  - label: query
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L61
  - label: level listing
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/levels.ts#L18
---

No input. Returns bare `Level[]`, lowest first, unwrapped from `/levels`.
Each level has a number, name, computed XP threshold, nullable role ID, limits, and permissions.

```ts
const levels = await getLevels();
```
