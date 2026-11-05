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
    example:
      token: lla_example
  responses:
    '200':
      empty: true
      description: The response body is empty; absent and unknown tokens also succeed.
    '400':
      description: Malformed JSON (`invalid_request`).
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L91
  - label: revocation
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L243
---

No authentication is required. Send the optional `token` as a form field or as a string-valued field in a JSON object,
not as a bare JSON string. Omitted, empty, and unknown tokens return the same empty `200` response.

Revoking an access token invalidates only that token; it leaves the grant's refresh token usable.
Revoking a refresh token invalidates every access and refresh token in its grant.
