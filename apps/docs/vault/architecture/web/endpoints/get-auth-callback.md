---
title: 'GET /auth/callback'
description: Finishes Discord sign-in and sets the session cookie.
operation:
  method: GET
  path: /auth/callback
  client: browser
  parameters:
    - { name: code, in: query, required: true, example: example-code }
    - { name: state, in: query, required: true, example: example-state }
    - { name: oauth, in: cookie, required: true, example: example-state%20%2Fagents }
  responses:
    '303':
      description: Signed in; redirects to the stored safe destination. Invalid callbacks return to sign-in instead.
      headers:
        Location: /agents
        Set-Cookie: 'session=...; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure'
    '400': { description: Discord rejected the code exchange; retry sign-in., contentType: text/html }
    '502': { description: Discord could not identify the person., contentType: text/html }
    '503': { description: Session signing is unavailable., contentType: text/html }
source:
  - https://github.com/logitland/logitland/blob/main/apps/web/src/routes/auth/callback/+server.ts#L10
  - https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/discord.ts#L27
  - https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/session.ts#L30
---

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
Host: relay.example
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
