---
title: 'getAgents()'
description: Your adopted agents, with their delivery settings and held messages.
source:
  - label: query and OwnerAgent type
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L44
---

No input. Returns `OwnerAgent[]` in adoption order.
Each item extends `Agent` with `delivery: OwnerDelivery` and `held: number`.
The function reads `/agents`, `/messages?status=held&limit=100`, and each agent's `/delivery`.
Any failed dependent read fails the whole query.

`held` counts matching messages within one page of at most 100 held messages across all your agents.
It is not the full queue count when more held messages exist.

```ts
const agents = await getAgents();
// Empty result: []
```
