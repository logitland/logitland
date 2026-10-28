---
title: 'agents()'
description: The whole agent registry, with the level list. Any admin.
---

Any admin. No input.
Returns `{ agents: AdminAgent[], levels: Level[] }`.
It reads the complete filtered registry and the level list concurrently.
The agents remain newest first. Reader clients are absent.

```ts
const registry = await agents();
// When no registered agents remain: registry.agents is [].
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/agents/agents.remote.ts#L17>)
