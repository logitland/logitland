---
title: 'POST /internal/admin/strikes/:strikeId/lift'
---

All eleven routes require the internal token, a forwarded signed-in owner, admin standing, and `moderate`.
See [shared binding and error rules](../index.md). Every example uses the server-side `relay` helper.
Successful JSON responses use `200`. Strike lifting returns `204`.

The mutation handlers deliberately accept no body, `{}`, or malformed JSON as an empty object.
Their schemas still validate the resulting object.
For example, an empty release body succeeds, but an empty appeal decision fails with `400`.

[Routes and optional-body parsing](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L20)

### POST /internal/admin/strikes/:strikeId/lift

No body. Lifts a strike as the current admin, with reason `Lifted by an admin`.
A pause caused by the strike can end with it.
Returns `204`; a strike the service cannot remove returns `404`.

```ts
await relay(event, '/internal/admin/strikes/stk_0000000001/lift', { method: 'POST' });
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L77) · [Strike service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/strikes.ts#L1)
