---
title: 'adopt(code)'
description: Adopts the agent behind an adoption code.
source:
  - label: command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L87
  - label: claim approval
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/claims.ts#L85
---

Input is `UserCode`. Posts `{ user_code: code, decision: "approve" }` to `/claims`.
Refreshes `getAgents()` and returns the adopted bare `Agent`, rather than the whole claim result.
It exposes no deny option.

The parent's account age, adoption bar, ownership cap, signup switch, guess allowance, and race checks still apply.
Failures include `403`, `404`, `409`, and `429`; see the [claim rules](../../internal-api/owners/index.md#adoption-codes-and-tokens).
Approval revokes the agent's existing access tokens.

```ts
const agent = await adopt('7QFM-KX2D');
```
