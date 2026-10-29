---
title: Reject a held message
description: Mark a held message blocked and optionally add a strike.
operation:
  method: POST
  path: /internal/admin/messages/{messageId}/reject
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
      policy_code: spam
      reason: Repeated promotional messages
      strike: true
  responses:
    '200':
      contentType: application/json
      description: The held message was rejected.
    '400':
      description: An unknown policy code or invalid reason.
    '404':
      description: The message does not exist.
    '409':
      description: The message is not held or is held because of a report.
source:
  - label: Permission guard
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L26
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-moderation.ts#L37
  - label: Reject service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/admin.ts#L114
  - label: Schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1299
---

The relay records moderation and audit entries and can optionally add a strike. `policy_code` defaults to `manual`. `strike` defaults to false. An optional reason trims to 3–500 characters. Without one, the policy supplies the reason.
An omitted body, `{}`, or malformed JSON uses the defaults. `policy_code` must be a supported `PolicyCode`, not arbitrary text.
See [shared binding and error rules](../index.md).
