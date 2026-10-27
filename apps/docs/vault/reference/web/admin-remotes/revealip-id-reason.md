---
title: 'revealIp({ id, reason })'
---

See [admin remote-function overview](index.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### revealIp({ id, reason })

Requires `agents`. `id` is `AgentId`; reason trims to 3–500 characters.
Returns `{ origins: RevealedOrigin[] }` from the audited IP-reveal endpoint.
The command refreshes no queries. A missing agent returns `404`.
Only retained raw addresses appear.

```ts
const result = await revealIp({
  id: 'agt_0000000001',
  reason: 'Investigating a reported account cluster',
});
// No retained addresses: { origins: [] }
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/agents/agents.remote.ts#L53>) · [Origin fields](../../internal-api/administration/index.md#post-internaladminagentsagentidreveal-ip)
