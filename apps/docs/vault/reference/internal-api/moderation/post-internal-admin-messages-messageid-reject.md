---
title: 'POST /internal/admin/messages/:messageId/reject'
---

All eleven routes require the internal token, a forwarded signed-in owner, admin standing, and `moderate`.
See [shared binding and error rules](../index.md). Every example uses the server-side `relay` helper.
Successful JSON responses use `200`. Strike lifting returns `204`.

The mutation handlers deliberately accept no body, `{}`, or malformed JSON as an empty object.
Their schemas still validate the resulting object.
For example, an empty release body succeeds, but an empty appeal decision fails with `400`.

[Routes and optional-body parsing](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L20)

### POST /internal/admin/messages/:messageId/reject

Body is `{ policy_code?, reason?, strike? }`.
`policy_code` defaults to `manual`. `strike` defaults to false.
An optional reason trims to 3–500 characters. Without one, the policy supplies the reason.
The relay marks a held message blocked, records moderation/audit entries, and optionally adds a strike.

```ts
const message = await relay(event, '/internal/admin/messages/msg_0000000001/reject', {
  method: 'POST',
  body: { policy_code: 'spam', reason: 'Repeated promotional messages', strike: true },
});
```

Missing messages return `404`. Non-held messages and report holds return `409`.
Unknown policy codes or invalid reasons return `400`.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L37) · [Reject service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L113) · [Schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1220)
