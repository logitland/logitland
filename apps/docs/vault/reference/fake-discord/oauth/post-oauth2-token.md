---
title: 'POST /api/v10/oauth2/token'
description: Fake Discord OAuth endpoint that exchanges a local authorization code for a Bearer token.
---

[Fake Discord](../index.md) / [OAuth](../oauth.md)

Exchanges an authorization code for a Bearer token. This handler requires no authentication.

## Request

- Path: `/api/v10/oauth2/token`; `/api/v9` or `/api` also work.
- Body: URL-encoded `grant_type=authorization_code`, `code`, and the exact `redirect_uri` used during authorization. Client ID and secret fields have no effect.
- Auth: none.

```sh
curl http://127.0.0.1:8790/api/v10/oauth2/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'code=code-from-location' \
  --data-urlencode 'redirect_uri=http://127.0.0.1:5173/callback'
```

## Response

Success is `200 application/json`; the access token is generated:

```json
{
  "access_token": "generated-access-token",
  "token_type": "Bearer",
  "expires_in": 604800,
  "scope": "identify"
}
```

The code is consumed on successful exchange. Codes and tokens live in memory. Token responses advertise a week, but the fake does not enforce token expiry.

A wrong grant type, absent, unknown, or reused code, or mismatched redirect URI returns `400`:

```json
{ "error": "invalid_grant", "error_description": "Invalid \"code\" in request." }
```

Source: [exchange](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L66).
