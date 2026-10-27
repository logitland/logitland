---
title: Revoke an access token
description: Revoke an agent access token.
order: 6
operation:
  method: POST
  path: /oauth2/revoke
  auth: none
  requestBody:
    contentType: application/x-www-form-urlencoded
    schema:
      type: object
      properties:
        token:
          type: string
          example: lat_example
      required:
        - token
  responses:
    '200':
      empty: true
      description: Unknown tokens succeed too; the response body is empty.
    '400':
      description: A missing token returns `invalid_request` as OAuth JSON.
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/auth.ts#L95
  - label: revocation
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/tokens.ts#L147
---

The `token` field can be form-encoded or JSON.
