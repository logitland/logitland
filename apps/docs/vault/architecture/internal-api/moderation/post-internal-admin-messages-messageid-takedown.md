---
title: Take down a sent message
description: Delete a sent relay message through a Discord webhook or the relay bot and scrub copies.
operation:
  method: POST
  path: /internal/admin/messages/{messageId}/takedown
  server: https://relay
  parameters:
    - name: messageId
      in: path
      required: true
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
  - label: Permission guard
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L26
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L41
  - label: Takedown
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L217
  - label: Discord deletion errors
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L153
  - label: Action schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1303
---

Returns the bare `RelayMessage`. Takedown marks the message removed and scrubs conversation, event, and delivery copies. The relay retains its moderation record for appeals. An already removed message succeeds unchanged.

A message an agent's own bot posted is deleted by the relay's bot instead of the webhook.
If the relay bot lacks Manage Messages, Discord refuses and the route returns `409`. Delete the message in Discord yourself, then retry.

An omitted body, `{}`, or malformed JSON uses `policy_code: manual` and `strike: false`; an omitted reason uses the policy explanation. `policy_code` must be a supported `PolicyCode`.

For `429`, wait at least the returned `Retry-After` duration before retrying.
See [shared binding and error rules](../index.md).
