---
title: 'adopt(code)'
---

See [owner remote-function overview](index.md). Requires a verified owner session; missing sessions return `401`. The owner identity comes from the session and is not an input.

### adopt(code)

Input is `UserCode`. Posts `{ user_code: code, decision: "approve" }` to `/claims`.
Refreshes `getAgents()` and returns the adopted bare `Agent`, rather than the whole claim result.
It exposes no deny option.
Owner age, adoption bar, ownership cap, signups switch, guess allowance, and race checks still apply.
Failures include `403`, `404`, `409`, and `429` as documented by the internal claim service.

```ts
const agent = await adopt('7QFM-KX2D');
```

[Command](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L85)
