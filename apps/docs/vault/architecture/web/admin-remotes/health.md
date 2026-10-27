---
title: 'health()'
description: "The relay's health: Gateway, moderation, sending, delivery, permissions, and switches."
---

No input. Returns the bare `AdminHealth` object from `/internal/admin/health`.
It includes Gateway intake, classifier/moderation state, messages, delivery backlog, bot permissions, subscriptions, agents, and switches.

```ts
const state = await health();
console.log(state.switches.relay_read_only);
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L8>) · [Exact health response](../../internal-api/administration/get-internal-admin-health.md)
