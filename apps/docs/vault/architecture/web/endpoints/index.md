---
title: Routes and forms
description: Discord sign-in and sign-out, page loads, llms.txt, and Markdown negotiation in the web app.
order: 1
---

These routes belong to `apps/web`, not the relay. Sessions come from the signed
[session cookie](../index.md#session-contract). Browser examples use made-up hostnames and codes.

| Route                                          | Does                                        |
| ---------------------------------------------- | ------------------------------------------- |
| [`GET /auth/discord`](get-auth-discord.md)     | Starts Discord sign-in                      |
| [`GET /auth/callback`](get-auth-callback.md)   | Finishes sign-in and sets the session       |
| [`POST /auth/sign-out`](post-auth-sign-out.md) | Clears the session                          |
| [`GET /llms.txt`](get-llms-txt.md)             | Lists every page's Markdown copy for agents |
| [Home `/`](home-load.md)                       | The home page's load                        |
| [`/sign-in`](sign-in-load.md)                  | The sign-in page's load                     |
| [Owner layout](owner-layout-load.md)           | The load every owner dashboard page shares  |
| [Admin layout](admin-layout-load.md)           | The load every admin dashboard page shares  |

Logan's consent page and its two form actions are with [Logan's OAuth](../../../admin/oauth/index.md).

## Markdown representations

Every page can be requested at its path without a trailing slash plus `.md`; the root uses `/index.md`.
The reroute hook maps those URLs to their underlying page before the server hook converts the response.
Only paths ending in `.md` participate in that explicit reroute.

```http
GET /agents.md HTTP/1.1
Host: relay.example
Cookie: session=<browser-session>
```

For normal GET page requests, `Accept` preference or a recognized agent `User-Agent` also selects Markdown.
This negotiation excludes SvelteKit data requests.
Recognized clients include Claude, OpenAI, and Perplexity crawlers, as well as command-line clients such as curl and Wget.
The [negotiation source](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/markdown/negotiate.ts#L8) defines the exact list.

```http
GET / HTTP/1.1
Host: relay.example
Accept: text/markdown
```

Markdown responses use `text/markdown; charset=utf-8`.
Negotiated responses add `Vary: Accept, User-Agent`.
Successful normal HTML page responses advertise alternate Markdown and llms.txt links.
Home and sign-in use handwritten Markdown, returned before their page loads run, even with a session.
Docs notes use the Markdown copies from the docs build, including frontmatter and absolute links to other notes.
Other HTML pages, including generated docs listings, convert through `pageToMarkdown`.

Unsigned requests for owner-app or admin-app pages receive sign-in Markdown with status `200`.
They do not gain dashboard data. Signed-in dashboard Markdown requests use the same session and route checks as HTML.
For explicit `.md` redirects to another page on this origin, the hook preserves the `.md` suffix.
Non-HTML responses pass through unchanged.

[Reroute](https://github.com/logitland/logitland/blob/main/apps/web/src/hooks.ts#L5) · [Path conversion](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/markdown-paths.ts#L1) · [Server hook](https://github.com/logitland/logitland/blob/main/apps/web/src/hooks.server.ts#L18) · [Handwritten and sign-in Markdown](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/markdown/pages.ts#L13) · [Docs Markdown](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/markdown/docs.ts#L40)
