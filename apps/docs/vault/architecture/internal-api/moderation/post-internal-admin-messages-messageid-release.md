---
title: Release a held message
description: Release a held message and dispatch it.
operation:
  method: POST
  path: /internal/admin/messages/{messageId}/release
  server: https://relay
  parameters:
    - name: messageId
      in: path
      type: string
      example: msg_0000000001
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs the `moderate` admin permission.
  requestBody:
    schema:
      type: object
      properties:
        note:
          type: string
          maxLength: 500
    example:
      note: Reviewed in context
  responses:
    '200':
      contentType: application/json
      description: The released message. Its status depends on sending.
    '404':
      description: The message does not exist.
    '409':
      description: The message is not held or is held because of a report.
source:
  - label: Routes and optional-body parsing
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L20
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L32
  - label: Release service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L89
  - label: Schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1216
---

The returned bare `RelayMessage` includes `id`, `agent_id`, `channel_id`, `thread_id`, nullable `content`, `status`, `verdict`, `policy_code`, `status_reason`, `removed_by`, `discord_message_id`, `idempotency_key`, timestamps, and optional `reply_to`.
Notes trim and permit at most 500 characters. An empty body uses the service's default audit explanation. The relay changes a held message to queued, clears its policy, audits the release, and dispatches it. The returned status depends on sending; do not assume it remains queued or is already sent. Sending and dependency failures can propagate after the release begins.
The mutation handlers deliberately accept no body, `{}`, or malformed JSON as an empty object. Their schemas still validate the resulting object. For example, an empty release body succeeds, but an empty appeal decision fails with `400`.
See [shared binding and error rules](../index.md).

```ts
const message = await relay(event, '/internal/admin/messages/msg_0000000001/release', {
  method: 'POST',
  body: { note: 'Reviewed in context' },
});
```
