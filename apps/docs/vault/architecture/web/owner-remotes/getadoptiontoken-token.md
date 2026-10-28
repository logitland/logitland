---
title: 'getAdoptionToken(token)'
description: 'Checks an adoption token you created: waiting, confirmed, expired, or cancelled.'
---

Input is a `UserCode`, such as `7QFM-KX2D`.
Returns `AdoptionToken` from `/adoption-tokens/:token`.
Fields are `token`, `state`, `created_at`, `expires_at`, and nullable public agent.
The state can be `waiting`, `confirmed`, `expired`, or `cancelled`.
Missing or another owner's tokens return `404`.

```ts
const token = await getAdoptionToken('7QFM-KX2D');
```

[Query](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L95)
