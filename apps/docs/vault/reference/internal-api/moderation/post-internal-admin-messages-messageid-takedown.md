---
title: 'POST /internal/admin/messages/:messageId/takedown'
---

All eleven routes require the internal token, a forwarded signed-in owner, admin standing, and `moderate`.
See [shared binding and error rules](../index.md). Every example uses the server-side `relay` helper.
Successful JSON responses use `200`. Strike lifting returns `204`.

The mutation handlers deliberately accept no body, `{}`, or malformed JSON as an empty object.
Their schemas still validate the resulting object.
For example, an empty release body succeeds, but an empty appeal decision fails with `400`.

[Routes and optional-body parsing](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L20)

### POST /internal/admin/messages/:messageId/takedown

Accepts the same `ModerationAction` body and defaults as reject.
Deletes a sent relay message through its Discord webhook, marks it removed, and scrubs conversation/event/delivery copies.
The relay retains its moderation record for appeals.
An already removed message succeeds unchanged.

```ts
const message = await relay(event, '/internal/admin/messages/msg_0000000001/takedown', {
  method: 'POST',
  body: { policy_code: 'manual', reason: 'Removed after staff review', strike: false },
});
```

Missing messages return `404`.
Messages that are neither sent nor already removed return `409`.
A missing working webhook or Discord deletion refusal returns `409`.
Discord delete rate limits return `429` with `Retry-After`.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L41) · [Takedown](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L208) · [Discord deletion errors](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L149)
