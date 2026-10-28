---
title: 'lookupClaim(code)'
description: Shows which agent an adoption code belongs to, before you adopt it.
---

Input is `UserCode`. Returns `{ user_code, expires_at, agent: PublicAgent }`.
Although it calls a GET route, this export is a command.
Invalid or nonwaiting codes spend an hourly guess, so query refresh must not repeat it.
Missing/expired/used codes return `404`; exhausted guesses return `429`; owned or inactive agents can return `409`.

```ts
const preview = await lookupClaim('7QFM-KX2D');
```

[Command](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L82) · [Claim behavior](../../internal-api/owners/index.md#adoption-codes-and-tokens)
