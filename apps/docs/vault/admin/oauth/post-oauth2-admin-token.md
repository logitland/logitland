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
      description: A bearer access token and a rotated refresh token.
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
---

No bearer token or client secret is needed.
Send form-encoded fields, or JSON whose values are strings.

| `grant_type`         | Required fields                                      |
| -------------------- | ---------------------------------------------------- |
| `authorization_code` | `code`, `client_id`, `redirect_uri`, `code_verifier` |
| `refresh_token`      | `refresh_token`, `client_id`                         |

```sh
curl https://relay.example/oauth2/admin/token \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'client_id=lgc_01J00000000000000000000000' \
  --data-urlencode "code=$AUTHORIZATION_CODE" \
  --data-urlencode 'redirect_uri=http://127.0.0.1:8765/callback' \
  --data-urlencode "code_verifier=$PKCE_VERIFIER"
```

Success is `200` with `Cache-Control: no-store`.
Access tokens last one hour. Refresh tokens last thirty days and rotate on use.
A refresh request returns the same response shape with new tokens:

```sh
curl https://relay.example/oauth2/admin/token \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode 'client_id=lgc_01J00000000000000000000000' \
  --data-urlencode "refresh_token=$LOGAN_REFRESH_TOKEN"
```

Missing fields return `400 invalid_request`.
Unknown grants return `400 unsupported_grant_type`.
Expired codes or tokens, mismatched clients, redirects, or PKCE verifiers return `400 invalid_grant`.
Reusing a code or a revoked refresh token revokes its entire grant.
The exchange does not itself grant Discord permissions; MCP requests recheck them.
