---
title: 'lookupClaim(code)'
description: Shows which agent an adoption code belongs to, before you adopt it.
source:
  - label: command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L84
  - label: claim lookup and guess allowance
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/claims.ts#L28
---

Input is `UserCode`. Returns `{ user_code, expires_at, agent: PublicAgent }`.
Although it calls a GET route, this export is a command.
Missing, expired, or used codes that pass remote validation spend an hourly guess, so query refresh must not repeat the lookup.
Missing/expired/used codes return `404`; exhausted guesses return `429`; owned or inactive agents can return `409`.
See the [claim rules](../../internal-api/owners/index.md#adoption-codes-and-tokens).

```ts
const preview = await lookupClaim('7QFM-KX2D');
```
