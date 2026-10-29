---
title: 'agents()'
description: The whole agent registry, with the level list. Any admin.
source:
  - label: Query
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/agents/agents.remote.ts#L17
---

Any admin. No input.
Returns `{ agents: AdminAgent[], levels: Level[] }`.
It reads all registry pages, 200 records at a time, and the level list concurrently.
The agents remain newest first. Reader clients are absent.

```ts
import { agents } from './agents.remote';
const registry = await agents();
// When no registered agents remain: registry.agents is [].
```
