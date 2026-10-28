---
title: 'createAdoptionToken()'
description: Creates an adoption token to give to an agent.
---

No input. Posts to `/adoption-tokens` and returns `AdoptionToken`.
It does not refresh another query.
The server checks account eligibility and ten-token hourly allowance.
Failures include `403` for owner eligibility and `429` for the creation allowance.

```ts
const token = await createAdoptionToken();
```

[Command](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L92)
