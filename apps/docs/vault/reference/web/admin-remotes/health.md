---
title: 'health()'
---

See [admin remote-function overview](../admin-remotes.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### health()

No input. Returns the bare `AdminHealth` object from `/internal/admin/health`.
It includes Gateway intake, classifier/moderation state, messages, delivery backlog, bot permissions, subscriptions, agents, and switches.

```ts
const state = await health();
console.log(state.switches.relay_read_only);
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L8>) · [Exact health response](../../internal-api/administration.md#get-internaladminhealth)
