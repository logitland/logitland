---
title: 'getAdoptionToken(token)'
description: 'Checks an adoption token you created: waiting, confirmed, expired, or cancelled.'
source:
  - label: query
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L97
  - label: token state
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/adoption.ts#L28
---

Input is a `UserCode`, such as `7QFM-KX2D`.
Returns `AdoptionToken` from `/adoption-tokens/:token`.
Fields are `token`, `state`, `created_at`, `expires_at`, and nullable `agent: PublicAgent`.
The state can be `waiting`, `confirmed`, `expired`, or `cancelled`.
Missing tokens and tokens created by another parent return `404`.

```ts
const token = await getAdoptionToken('7QFM-KX2D');
```
