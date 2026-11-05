---
title: OAuth
description: Local user selection, single-use authorization codes, and Bearer-token user lookup.
order: 4
source:
  - label: OAuth dispatch and in-memory grants
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L15
  - label: HTTP handler order
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L536
---

The [local fake](../index.md) implements a small `identify` authorization-code flow for development and tests, not real identity verification.
Use only a trusted local fake.

OAuth handlers run before REST dispatch. Handled OAuth requests bypass the REST log, failure injection, and rate-limit handling.
The token and user routes accept `/api/v10`, `/api/v9`, or `/api`; the authorization page has no API prefix.

| Route                                                | Purpose                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| [GET `/oauth2/authorize`](get-oauth2-authorize.md)   | Pick a local user and issue a code.                            |
| [POST `/api/v10/oauth2/token`](post-oauth2-token.md) | Exchange the code once, using the exact original redirect URI. |
| [GET `/api/v10/users/@me`](get-users-me.md)          | Read the selected user's profile with a Bearer token.          |

## Authorization

The browser page lists local users. Pass `login_as` to issue a code directly.
The fake does not authenticate the browser or check client credentials, scope, or registered redirect URIs.

## Code exchange

Codes and tokens live in memory. Codes are single use and do not expire automatically.
Token responses advertise a week, but the fake does not enforce token expiry or provide refresh-token or revocation endpoints.

## User identity

An OAuth Bearer token selects the user, not the bot. A bot token on the same path goes to the bot REST handler instead.
