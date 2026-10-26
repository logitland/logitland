---
title: 'GET /auth/callback'
---

These contracts belong to `apps/web`, not the relay's public REST registry.
Browser examples use fictitious hostnames and codes.
Application sessions come from the signed [session cookie](../index.md#session-contract).

## GET /auth/callback

Discord supplies query parameters `code` and `state`.
The handler reads then deletes the `oauth` cookie before validating the callback.
Missing code, missing cookie state, or mismatched state redirects `303` to `/sign-in?next=<encoded-safe-path>`.
This also handles a declined Discord authorization, since no usable code exists.

For a valid callback, the server exchanges the code with Discord and fetches `/users/@me`.
It calls `POST /internal/owners` with that Discord user ID and username.
It signs a new 30-day session containing the owner and avatar, then redirects `303` to the safe stored destination.
There is no JSON success response.

```http
GET /auth/callback?code=example-code&state=example-state HTTP/1.1
Host: logitland.example
Cookie: oauth=example-state%20%2Fagents
```

```http
HTTP/1.1 303 See Other
Location: /agents
Set-Cookie: session=...; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure
```

The code and cookie must come from the actual preceding OAuth flow; these are format examples.
Discord rejecting the token exchange produces `400` with a retry-sign-in message.
Discord failing to identify the person produces `502`.
Missing `SESSION_SECRET` produces `503` when writing the session.
Internal owner-service errors retain their HTTP status through the binding helper.

[Handler](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/auth/callback/+server.ts#L10) · [Discord exchange errors](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/discord.ts#L27) · [Session write](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/session.ts#L30)
