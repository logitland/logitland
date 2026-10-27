---
title: 'agents()'
---

See [admin remote-function overview](index.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### agents()

Any admin. No input.
Returns `{ agents: AdminAgent[], levels: Level[] }`.
It reads the complete filtered registry and the level list concurrently.
The agents remain newest first. Reader clients are absent.

```ts
const registry = await agents();
// When no registered agents remain: registry.agents is [].
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/agents/agents.remote.ts#L17>)
