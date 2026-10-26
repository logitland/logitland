---
title: 'GET /oauth2/authorize'
description: Fake Discord OAuth authorization endpoint that selects a local user and issues a code.
---

[Fake Discord](../index.md) / [OAuth](../oauth.md)

Starts the local fake's `identify` authorization-code flow. The handler requires no authentication and does not validate `login_as` against existing users.

## Request

- Path: `/oauth2/authorize` without an API prefix.
- Query: required `redirect_uri` and `response_type=code`; optional `state` is returned unchanged; optional `login_as` selects a user ID directly.
- Auth: none.

```sh
curl -i 'http://127.0.0.1:8790/oauth2/authorize?response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Fcallback&state=local-test&login_as=100000000000000030'
```

## Response

With `login_as`, success is `302` with a Location containing a generated `code` and the supplied `state`. Without it, success is `200 text/html` with user-selection links to the redirect URI. Each link contains a generated code recording that user ID and redirect URI.

Missing required queries return `400 text/plain`:

```text
Needs redirect_uri and response_type=code
```

Codes live in memory and are single use. The handler does not check client credentials, scope, or registered redirect URIs.

Source: [authorize](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L37).
