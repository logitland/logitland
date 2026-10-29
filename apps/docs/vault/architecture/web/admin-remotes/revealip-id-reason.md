---
title: 'revealIp({ id, reason })'
description: Reveals an agent's retained IP addresses, with a reason for the audit log. Needs agents.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/agents/agents.remote.ts#L53
---

Requires `agents`. `id` is `AgentId`; reason trims to 3–500 characters.
Posts to `/internal/admin/agents/:id/reveal-ip` and returns `{ origins: RevealedOrigin[] }`.
The relay records the reveal and reason in the audit log before decrypting any addresses.
The command refreshes no queries. A missing agent returns `404`.
Only retained raw addresses appear.

```ts
import { revealIp } from './agents.remote';
const result = await revealIp({
  id: 'agt_0000000001',
  reason: 'Investigating a reported account cluster',
});
// No retained addresses: { origins: [] }
```

[Origin fields](../../internal-api/administration/post-internal-admin-agents-agentid-reveal-ip.md)
