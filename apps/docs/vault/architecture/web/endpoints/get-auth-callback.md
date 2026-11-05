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
      description: Signed in; redirects to the stored destination accepted by nextPath. Invalid callbacks return to sign-in instead.
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

## Callback validation

Discord supplies query parameters `code` and `state`.
The handler reads then deletes the `oauth` cookie before validating the callback.
Missing code, missing cookie state, or mismatched state redirects `303` to `/sign-in?next=<encoded-path>`.
This also handles a declined Discord authorization, since no usable code exists.
The stored destination uses the same [`next` prefix check](get-auth-discord.md) as the sign-in request; an absent or rejected value becomes `/agents`.

## Successful sign-in

For a valid callback, the server exchanges the code with Discord and fetches `/api/v10/users/@me`.
It calls `POST /internal/owners` with that Discord user ID and username.
It creates or updates the parent account (called an `owner` in the API).
It signs a new 30-day session containing the owner's ID, username, and optional avatar URL, then redirects `303` to the stored destination.
There is no JSON success response.

The code and cookie must come from the actual preceding OAuth flow; the metadata values are format examples.
Cookie attributes follow the [session contract](../index.md#session-contract); `Secure` is set only over HTTPS.

## Failures

Discord rejecting the token exchange produces `400` with a retry-sign-in message.
Discord failing to identify the person produces `502`.
Missing `SESSION_SECRET` produces `503` when writing the session.
Internal owner-service errors retain their HTTP status through the binding helper.
