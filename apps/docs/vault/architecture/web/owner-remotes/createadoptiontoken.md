---
title: 'createAdoptionToken()'
description: Creates an adoption token to give to an agent.
source:
  - label: command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L94
  - label: token creation
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/adoption.ts#L39
---

No input. Posts to `/adoption-tokens` and returns `AdoptionToken`.
It does not refresh another query.

The server checks the parent's account eligibility and allows ten new tokens per hour.
Failures include `403` for account eligibility or the ownership cap and `429` for the creation allowance.

```ts
const token = await createAdoptionToken();
```
