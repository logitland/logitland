---
title: Fake Discord OAuth
description: Local user selection, single-use authorization codes, and Bearer-token user lookup.
---

The [local fake](index.md) implements a small `identify` authorization-code flow.
It does not check client credentials, scope, or registered redirect URIs.
Codes and tokens live in memory. Token responses advertise a week, but the fake does not enforce token expiry.

The authorize handler uses `/oauth2/authorize` without an API prefix.
Token exchange and user lookup accept `/api/v10`, `/api/v9`, or `/api`.
These OAuth handlers run before REST dispatch and do not enter the REST request log.

Sources: [OAuth dispatch](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L24),
[in-memory grants](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L15),
[HTTP handler order](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L501).

## Authorization

`GET /oauth2/authorize` requires no authentication.
Required queries are `redirect_uri` and `response_type=code`.
Optional `state` returns unchanged in the redirect.
Optional `login_as` selects a user ID directly; otherwise, the HTML page lists non-bot users.
The handler does not validate `login_as` against existing users.

```sh
curl -i 'http://127.0.0.1:8790/oauth2/authorize?response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Fcallback&state=local-test&login_as=100000000000000030'
```

With `login_as`, success is `302` with a Location containing a generated `code` and the supplied `state`.
Without it, success is `200 text/html` with user-selection links to the redirect URI.
Each link contains a generated code. The code records that user ID and redirect URI.
Missing required queries return `400 text/plain`:

```text
Needs redirect_uri and response_type=code
```

Source: [authorize](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L37).

## Code exchange

`POST /api/v10/oauth2/token` requires no authentication.
Send URL-encoded fields `grant_type=authorization_code`, `code`, and the exact `redirect_uri` used during authorization.
Client ID and secret fields have no effect.

```sh
curl http://127.0.0.1:8790/api/v10/oauth2/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'code=code-from-location' \
  --data-urlencode 'redirect_uri=http://127.0.0.1:5173/callback'
```

Success is `200 application/json`. The access token is generated:

```json
{
  "access_token": "generated-access-token",
  "token_type": "Bearer",
  "expires_in": 604800,
  "scope": "identify"
}
```

A successful exchange consumes the code.
A wrong grant type, absent/unknown/reused code, or mismatched redirect URI returns `400`:

```json
{ "error": "invalid_grant", "error_description": "Invalid \"code\" in request." }
```

Source: [exchange](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L66).

## User identity

`GET /api/v10/users/@me` with `Authorization: Bearer <access-token>` returns that token's User with `200`.
The User includes `id`, `username`, `discriminator`, `global_name`, `avatar`, and optional bot/flag fields.

```sh
curl http://127.0.0.1:8790/api/v10/users/@me \
  -H 'Authorization: Bearer generated-access-token'
```

An unknown token, or a token whose user does not exist, returns `401`:

```json
{ "message": "401: Unauthorized", "code": 0 }
```

Without a nonempty Bearer header, this path falls through to the [bot REST handler](bot-rest.md#discovery-and-identity).
There is no fake refresh-token or revocation endpoint.

Source: [user identity](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L83).
