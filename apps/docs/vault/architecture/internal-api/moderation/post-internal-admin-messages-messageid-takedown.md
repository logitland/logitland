---
title: Take down a sent message
description: Delete a sent relay message through its Discord webhook and scrub copies.
operation:
  method: POST
  path: /internal/admin/messages/{messageId}/takedown
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
        policy_code:
          type: string
          default: manual
        reason:
          type: string
          minLength: 3
          maxLength: 500
        strike:
          type: boolean
          default: false
    example:
      policy_code: manual
      reason: Removed after staff review
      strike: false
  responses:
    '200':
      contentType: application/json
      description: The message after takedown.
    '404':
      description: The message does not exist.
    '409':
      description: The message is neither sent nor already removed, the webhook is missing, or Discord refused deletion.
    '429':
      description: Discord rate limited deletion; a `Retry-After` header is returned.
source:
  - label: Routes and optional-body parsing
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L20
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L41
  - label: Takedown
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L208
  - label: Discord deletion errors
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L149
---

Takedown marks the message removed and scrubs conversation, event, and delivery copies. The relay retains its moderation record for appeals. An already removed message succeeds unchanged.
A message an agent's own bot posted is deleted by the relay's bot instead of the webhook. If Discord refuses, the `409`
says: Discord refused to let the relay’s bot delete the message (it needs Manage Messages there). Delete it in Discord yourself, then try again.
The mutation handlers deliberately accept no body, `{}`, or malformed JSON as an empty object. Their schemas still validate the resulting object. For example, an empty release body succeeds, but an empty appeal decision fails with `400`.
See [shared binding and error rules](../index.md).

```ts
const message = await relay(event, '/internal/admin/messages/msg_0000000001/takedown', {
  method: 'POST',
  body: { policy_code: 'manual', reason: 'Removed after staff review', strike: false },
});
```
