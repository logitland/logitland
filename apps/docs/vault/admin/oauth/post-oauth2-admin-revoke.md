---
title: Revoke a Logan token
description: Revoke an access or refresh token (RFC 7009); a refresh token ends its grant.
order: 8
operation:
  method: POST
  path: /oauth2/admin/revoke
  auth: none
  requestBody:
    contentType: application/x-www-form-urlencoded
    schema:
      type: object
      properties:
        token:
          type: string
          example: lla_example
  responses:
    '200':
      empty: true
      description: The response body is empty; absent and unknown tokens also succeed.
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L91
  - label: revocation
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L243
---

No authentication. The optional `token` field can be form-encoded or a JSON string.
An access token revokes itself; a refresh token revokes the entire grant.
