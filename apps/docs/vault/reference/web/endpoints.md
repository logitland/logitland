---
title: Web endpoints and forms
description: Discord sign-in and callback, sign-out, Logan consent actions, page loads, llms.txt, and Markdown negotiation.
---

These contracts belong to `apps/web`, not the relay's public REST registry.
Browser examples use fictitious hostnames and codes.
Application sessions come from the signed [session cookie](index.md#session-contract).

## GET /auth/discord

[GET /auth/discord](./endpoints/get-auth-discord.md)

## GET /auth/callback

[GET /auth/callback](./endpoints/get-auth-callback.md)

## POST /auth/sign-out

[POST /auth/sign-out](./endpoints/post-auth-sign-out.md)

## GET /llms.txt

[GET /llms.txt](./endpoints/get-llms-txt.md)

## Logan consent page

### GET /oauth/authorize

[GET /oauth/authorize](./endpoints/get-oauth-authorize.md)

### POST /oauth/authorize?/allow

[POST /oauth/authorize?/allow](./endpoints/post-oauth-authorize-allow.md)

### POST /oauth/authorize?/deny

[POST /oauth/authorize?/deny](./endpoints/post-oauth-authorize-deny.md)

## Page loads

- [Home /](./endpoints/home-load.md)
- [/sign-in](./endpoints/sign-in-load.md)
- [Owner layout](./endpoints/owner-layout-load.md)
- [Admin layout](./endpoints/admin-layout-load.md)

## Markdown representations

Every page can be requested at its path plus `.md`; the root uses `/index.md`.
The reroute hook maps those URLs to their underlying page before the server hook converts the response.
Only paths ending in `.md` participate in that explicit reroute.

```http
GET /agents.md HTTP/1.1
Host: logitland.example
Cookie: session=<browser-session>
```

For normal GET page requests, `Accept` preference or a recognized agent `User-Agent` also selects Markdown.
This negotiation excludes SvelteKit data requests.
Recognized clients include Claude/OpenAI crawlers, Perplexity, several other crawlers, curl, Wget, HTTPie, python-requests, Go-http-client, node-fetch, undici.
The source owns the exact list.

```http
GET / HTTP/1.1
Host: logitland.example
Accept: text/markdown
```

Markdown responses use `text/markdown; charset=utf-8`.
Negotiated responses add `Vary: Accept, User-Agent`.
Successful normal HTML page responses advertise alternate Markdown and llms.txt links.
Home and sign-in use handwritten Markdown; other HTML pages convert through `pageToMarkdown`.

Unsigned requests for owner-app or admin-app pages receive sign-in Markdown with status `200`.
They do not gain dashboard data. Signed-in Markdown requests use the same session and route checks as HTML.
For explicit `.md` redirects to another page on this origin, the hook preserves the `.md` suffix.
Non-HTML responses pass through unchanged.

[Reroute](https://github.com/logitland/logitland/blob/main/apps/web/src/hooks.ts#L5) · [Path conversion](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/markdown-paths.ts#L1) · [Server hook](https://github.com/logitland/logitland/blob/main/apps/web/src/hooks.server.ts#L18) · [Agent negotiation](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/markdown/negotiate.ts#L11) · [Handwritten and sign-in Markdown](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/markdown/pages.ts#L3)
