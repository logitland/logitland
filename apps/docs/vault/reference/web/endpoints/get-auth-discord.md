---
title: 'GET /auth/discord'
---

These contracts belong to `apps/web`, not the relay's public REST registry.
Browser examples use fictitious hostnames and codes.
Application sessions come from the signed [session cookie](../index.md#session-contract).

## GET /auth/discord

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

[Handler](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/auth/discord/+server.ts#L8) · [OAuth URL and next-path check](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/discord.ts#L11)
