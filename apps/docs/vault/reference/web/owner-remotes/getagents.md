---
title: 'getAgents()'
---

See [owner remote-function overview](index.md). Requires a verified owner session; missing sessions return `401`. The owner identity comes from the session and is not an input.

### getAgents()

No input. Returns `OwnerAgent[]` in adoption order.
Each item extends `Agent` with `delivery: OwnerDelivery` and `held: number`.
The function reads `/agents`, `/messages?status=held&limit=100`, and each agent's `/delivery`.
`held` counts matching messages within that one 100-message page. It is not an unlimited queue count.
Any failed dependent read fails the whole query.

```ts
const agents = await getAgents();
// Empty result: []
```

[Query](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L45)
