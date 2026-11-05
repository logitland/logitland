---
title: Exchange a Logan token grant
description: Exchange an authorization code with its PKCE verifier or a refresh token.
order: 7
operation:
  method: POST
  path: /oauth2/admin/token
  auth: none
  requestBody:
    contentType: application/x-www-form-urlencoded
    schema:
      oneOf:
        - type: object
          description: Exchanges an authorization code and its PKCE verifier.
          properties:
            grant_type:
              type: string
              const: authorization_code
            code:
              type: string
              minLength: 1
            client_id:
              type: string
              minLength: 1
            redirect_uri:
              type: string
              minLength: 1
            code_verifier:
              type: string
              minLength: 1
          required:
            - grant_type
            - code
            - client_id
            - redirect_uri
            - code_verifier
        - type: object
          description: Rotates a refresh token.
          properties:
            grant_type:
              type: string
              const: refresh_token
            refresh_token:
              type: string
              minLength: 1
            client_id:
              type: string
              minLength: 1
          required:
            - grant_type
            - refresh_token
            - client_id
    example:
      grant_type: authorization_code
      client_id: lgc_01J00000000000000000000000
      code: <authorization-code>
      redirect_uri: http://127.0.0.1:8765/callback
      code_verifier: <pkce-verifier>
  responses:
    '200':
      description: A new bearer access token and refresh token, with Cache-Control no-store.
      example:
        access_token: lla_example
        token_type: Bearer
        expires_in: 3600
        refresh_token: llr_example
        scope: logan
    '400':
      description: Invalid request, unsupported grant, or invalid grant.
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L86
  - label: exchange
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L188
  - label: form and JSON fields
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/shared.ts#L34
---

No bearer token or client secret is needed.
Send form-encoded fields, or a JSON object whose field values are strings. Non-string fields are ignored.

| `grant_type`         | Required fields                                      |
| -------------------- | ---------------------------------------------------- |
| `authorization_code` | `code`, `client_id`, `redirect_uri`, `code_verifier` |
| `refresh_token`      | `refresh_token`, `client_id`                         |

The code is single-use and expires five minutes after consent. Use the exact `redirect_uri` from authorization,
even if its loopback port differs from registration. The verifier must match that authorization's PKCE challenge.

## Lifetime and rotation

Access tokens last one hour. Refresh tokens last thirty days from issuance and rotate on use.
Replace the stored refresh token with the new one after each successful refresh. Rotation invalidates the old refresh
token but does not invalidate earlier access tokens; those remain usable until expiry or revocation.
The returned scope is always `logan`, regardless of the scope string sent during authorization.

## Errors

Exchange errors use HTTP `400` with `{ error, error_description }`:

- `invalid_request`: a required field is missing or empty, or the JSON is malformed.
- `unsupported_grant_type`: the grant type is not supported.
- `invalid_grant`: the code or refresh token is unknown, expired, used or revoked, or its client, redirect, or PKCE verifier does not match.

Do not retry a used code or an old refresh token: replay detection revokes the grant. Start authorization again instead.

The exchange does not itself grant Discord permissions; MCP requests recheck them.
