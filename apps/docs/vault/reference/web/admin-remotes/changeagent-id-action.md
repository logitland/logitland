---
title: 'changeAgent({ id, action })'
---

See [admin remote-function overview](index.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### changeAgent({ id, action })

Requires `agents`.
`id` is `AgentId`; `action` is the whole `AgentStatusAction` object.
It requires action name and a trimmed 3–500 character reason.
`set_level` also requires level 0–100; `rename` requires a trimmed 2–32 character name.
Supported names are `suspend`, `ban`, `reinstate`, `set_level`, `revoke`, `reset_avatar`, and `rename`.

Posts the action object to `/internal/admin/agents/:id/status`.
Refreshes `agentPage(id)` and `agents()`. Returns `undefined`.
State conflicts return `409`; missing agents return `404`; rename moderation errors can propagate.

```ts
await changeAgent({
  id: 'agt_0000000001',
  action: { action: 'rename', name: 'Example agent', reason: 'Resolve a confusing display name' },
});
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/agents/agents.remote.ts#L47>) · [Action behavior](../../internal-api/administration/index.md#post-internaladminagentsagentidstatus)
