---
title: Exchange an authorization code
description: Exchange a local authorization code for a Bearer token.
operation:
  method: POST
  path: /api/v10/oauth2/token
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    contentType: application/x-www-form-urlencoded
    schema:
      type: object
      properties:
        grant_type:
          type: string
          const: authorization_code
        code:
          type: string
          description: The code from the authorization redirect.
        redirect_uri:
          type: string
          description: The exact redirect URI used during authorization.
      required:
        - grant_type
        - code
        - redirect_uri
    example:
      grant_type: authorization_code
      code: code-from-location
      redirect_uri: http://127.0.0.1:5173/callback
  responses:
    '200':
      description: A generated Bearer token. The code is consumed.
      example:
        access_token: generated-access-token
        token_type: Bearer
        expires_in: 604800
        scope: identify
    '400':
      description: A wrong grant type, an absent, unknown, or reused code, or a mismatched redirect URI.
      example:
        error: invalid_grant
        error_description: Invalid "code" in request.
source:
  - label: exchange
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L66
---

The `/api/v9` and `/api` prefixes also work. Client ID and secret fields have no effect.

A successful exchange consumes the code. A failed exchange leaves it available, so a wrong redirect URI can be corrected without authorizing again.
Use the returned token for [OAuth user lookup](get-users-me.md), not as a bot token.

Codes and tokens live in memory. `expires_in: 604800` advertises a week in seconds, but the fake does not enforce token expiry.
The response has no refresh token, and the fake has no refresh-token or revocation endpoint.
