---
title: 'POST /internal/admin/messages/:messageId/release'
---

All eleven routes require the internal token, a forwarded signed-in owner, admin standing, and `moderate`.
See [shared binding and error rules](../index.md). Every example uses the server-side `relay` helper.
Successful JSON responses use `200`. Strike lifting returns `204`.

The mutation handlers deliberately accept no body, `{}`, or malformed JSON as an empty object.
Their schemas still validate the resulting object.
For example, an empty release body succeeds, but an empty appeal decision fails with `400`.

[Routes and optional-body parsing](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L20)

These return the bare `RelayMessage`, not `{ message }`.
Its fields include `id`, `agent_id`, `channel_id`, `thread_id`, nullable `content`, `status`, `verdict`, `policy_code`, `status_reason`, `removed_by`, `discord_message_id`, `idempotency_key`, timestamps, and optional `reply_to`.

### POST /internal/admin/messages/:messageId/release

Body is `{ note?: string }`. Notes trim and permit at most 500 characters.
An empty body uses the service's default audit explanation.
The relay changes a held message to queued, clears its policy, audits the release, and dispatches it.
The returned status depends on sending; do not assume it remains queued or is already sent.

```ts
const message = await relay(event, '/internal/admin/messages/msg_0000000001/release', {
  method: 'POST',
  body: { note: 'Reviewed in context' },
});
```

Missing messages return `404`. Non-held messages or report holds return `409`.
Sending and dependency failures can propagate after the release begins.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L32) · [Release service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L89) · [Schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1216)
