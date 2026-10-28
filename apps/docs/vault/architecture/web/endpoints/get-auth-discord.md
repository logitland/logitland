---
title: 'GET /auth/discord'
description: Starts Discord sign-in.
operation:
  method: GET
  path: /auth/discord
  client: browser
  parameters:
    - { name: next, in: query, description: Safe local destination after sign-in; defaults to /agents., example: /agents }
  responses:
    '303':
      description: Redirect to the configured Discord OAuth server; fields shown are format examples.
      headers:
        Location: https://discord.com/oauth2/authorize?client_id=example-client-id&response_type=code&scope=identify&redirect_uri=https://relay.example/auth/callback&state=example-state
        Set-Cookie: 'oauth=...; Path=/auth; Max-Age=600; HttpOnly; SameSite=Lax; Secure'
source:
  - https://github.com/logitland/logitland/blob/main/apps/web/src/routes/auth/discord/+server.ts#L8
  - https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/discord.ts#L11
---

Start Discord OAuth sign-in. There is no required session or body.
Optional `next` must start with one slash and cannot start with `//`.
An invalid or absent destination becomes `/agents`.
The handler generates a UUID state and writes the `oauth` cookie as `<state> <next>`.
The cookie lasts 600 seconds, uses path `/auth`, and shares the session cookie's HTTP-only, SameSite, and Secure rules.

The response is `303` to Discord's `/oauth2/authorize`, using the configured Discord base URL.
It sends `client_id`, `response_type=code`, `scope=identify`, callback URI, and generated state.
The callback URI is the current request origin plus `/auth/callback`.

```http
GET /auth/discord?next=%2Fagents HTTP/1.1
Host: relay.example
```

```http
HTTP/1.1 303 See Other
Location: https://discord.com/oauth2/authorize?client_id=...&response_type=code&scope=identify&redirect_uri=...&state=...
Set-Cookie: oauth=...; Path=/auth; Max-Age=600; HttpOnly; SameSite=Lax; Secure
```

The cookie encoding and parameter ordering belong to the framework; the response above shows the contract's fields.
