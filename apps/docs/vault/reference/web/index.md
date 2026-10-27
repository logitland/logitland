---
title: Web contracts
description: Browser endpoints, Discord sessions, Logan consent form actions, Markdown responses, and SvelteKit remote functions.
order: 4
---

The web Worker serves browser pages, Discord sign-in, Logan's consent page, and generated Markdown.
Server-side queries and commands call the relay through the private `RELAY` binding.
They forward the verified session's owner ID. They never forward a browser-supplied owner identity.

| Area                       | Reference                                                                       |
| -------------------------- | ------------------------------------------------------------------------------- |
| HTTP and forms             | [Sign-in, sign-out, consent, loads, Markdown, and llms.txt](endpoints/index.md) |
| Owner queries and commands | [Owner remote functions](owner-remotes/index.md)                                |
| Admin queries and commands | [Admin remote functions](admin-remotes/index.md)                                |
| Home-page forum reader     | [Showcase remote query](showcase-remote/index.md)                               |
| Binding behind the web app | [Internal API](../internal-api/index.md)                                        |

## Session contract

The `session` cookie contains a base64url JSON payload and HMAC-SHA-256 signature, separated by a period.
The payload contains owner `id`, `username`, optional avatar URL, and expiry `exp`.
It expires after 30 days.
The cookie is HTTP-only, SameSite Lax, scoped to `/`, and Secure when the request uses HTTPS.
Older valid cookies can omit the avatar.

Every server request runs `readSession` and sets `event.locals.owner` only for a valid, unexpired signature.
A malformed, unsigned, expired, or unverifiable cookie yields no owner.
Admin permissions are not stored in the cookie.
Dashboard loads ask the relay for current standing.
The relay also checks standing for every admin API call.

[Session implementation](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/session.ts#L1) · [Request hook](https://github.com/logitland/logitland/blob/main/apps/web/src/hooks.server.ts#L18) · [Standing load](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/dashboard.ts#L10)

## Remote-function transport

The `*.remote.ts` modules export SvelteKit `query` and `command` functions.
Import those functions into the SvelteKit application to call them.
SvelteKit owns their generated transport URLs, payload encoding, validation, caching, and refresh protocol.
The source does not define stable REST URLs for these exports.
Do not turn names such as `getAgents` or `saveHome` into invented `/api/*` endpoints.

The examples in these references are application calls, not external HTTP requests.
Inputs use the exact Zod schema supplied to `query` or `command`.
Server requests obtain the session from `getRequestEvent()`.
Owner calls without a session fail with `401`, asking the person to sign in again.
Admin calls pass through `admin()` and the binding helper, then fail at the relay when standing is insufficient.

Most mutation commands refresh affected queries before returning.
The command's JavaScript return value can be `undefined` even when the underlying REST operation returns JSON.
The reference distinguishes those two contracts.

[Owner remotes](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L1) · [Admin binding wrapper](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/admin.ts#L7) · [Relay errors to SvelteKit errors](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/relay.ts#L27)
