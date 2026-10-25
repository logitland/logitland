---
title: Web endpoints and forms
description: Discord sign-in and callback, sign-out, Logan consent actions, page loads, llms.txt, and Markdown negotiation.
---

These contracts belong to `apps/web`, not the relay's public REST registry.
Browser examples use fictitious hostnames and codes.
Application sessions come from the signed [session cookie](index.md#session-contract).

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
Host: logitland.example
```

```http
HTTP/1.1 303 See Other
Location: https://discord.com/oauth2/authorize?client_id=...&response_type=code&scope=identify&redirect_uri=...&state=...
Set-Cookie: oauth=...; Path=/auth; Max-Age=600; HttpOnly; SameSite=Lax; Secure
```

The cookie encoding and parameter ordering belong to the framework; the response above shows the contract's fields.

[Handler](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/auth/discord/+server.ts#L8) · [OAuth URL and next-path check](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/discord.ts#L11)

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

## POST /auth/sign-out

No body or prior session is required by the handler.
Delete the `session` cookie at `/` and redirect `303` to `/sign-in`.
This does not delete the owner account or call a Discord token revocation endpoint.
No GET sign-out handler exists.

```html
<form method="post" action="/auth/sign-out">
  <button>Sign out</button>
</form>
```

```http
HTTP/1.1 303 See Other
Location: /sign-in
```

[Handler](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/auth/sign-out/+server.ts#L4) · [Cookie deletion](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/session.ts#L51)

## GET /llms.txt

No session, body, or query is required.
Returns the generated `llmsTxt(url.origin)` text with `Content-Type: text/markdown; charset=utf-8`.
The request origin supplies absolute addresses in the document.
The handler sets no explicit cache policy.

```http
GET /llms.txt HTTP/1.1
Host: logitland.example
```

```http
HTTP/1.1 200 OK
Content-Type: text/markdown; charset=utf-8
```

[Handler](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/llms.txt/+server.ts#L3) · [Text generator](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/fixtures/marketing/site.ts#L1)

## Logan consent page

### GET /oauth/authorize

This page is Logan's browser authorization step for MCP OAuth.
Without a session, redirect `303` to `/sign-in?next=<encoded-path-and-query>`.
With a session, parse the authorization fields, then call the owner's internal Logan consent route.
The page load returns `{ request, consent, username }` to its Svelte page.
`consent` contains `{ client_name, allowed }`.

Required query fields are `response_type`, `client_id`, `redirect_uri`, `code_challenge`, and `code_challenge_method`.
Optional fields are `state`, `scope`, and `resource`.
The relay requires response type `code`, PKCE method `S256`, and a registered redirect.
See [the full authorization schema and service checks](../internal-api/owners.md#logan-oauth-owner-routes).

```http
GET /oauth/authorize?response_type=code&client_id=lgc_0000000001&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code_challenge_method=S256&state=example-state HTTP/1.1
Host: logitland.example
Cookie: session=<browser-session>
```

Missing or malformed fields produce `400` with `This sign-in link is incomplete. Start again from your MCP client.`
Relay validation errors also become HTTP errors on this page, rather than redirecting to an unverified client URL.

[Load and parser](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L13)

### POST /oauth/authorize?/allow

This is the SvelteKit named form action `allow`.
Send form data containing the same authorization fields as the GET query.
The server adds `decision: "allow"` and calls the internal authorization route.
The relay revalidates the client request and requires the owner's `logan` permission.
The response redirects `303` to the returned registered client URI, carrying an authorization code, issuer, and optional state.

```html
<form method="post" action="?/allow">
  <input type="hidden" name="response_type" value="code" />
  <input type="hidden" name="client_id" value="lgc_0000000001" />
  <input type="hidden" name="redirect_uri" value="https://client.example/callback" />
  <input type="hidden" name="code_challenge" value="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" />
  <input type="hidden" name="code_challenge_method" value="S256" />
  <input type="hidden" name="state" value="example-state" />
  <button>Allow</button>
</form>
```

The form works only for an actual registered client and signed-in owner.
An expired session produces `401`, not a sign-in redirect.
Invalid fields/client/redirect/PKCE produce `400`. Missing `logan` produces `403`.

### POST /oauth/authorize?/deny

This is the named form action `deny`.
It accepts the same form fields and adds `decision: "deny"`.
The client request must still validate; denying does not require the `logan` permission.
The response redirects `303` to the registered client URI with `error=access_denied`, issuer, and optional state.

```html
<!-- Use the same hidden authorization fields as the allow form. -->
<button formmethod="post" formaction="?/deny">Cancel</button>
```

Missing session produces `401`; invalid authorization fields produce `400`.
Neither action reads an owner ID or decision from untrusted hidden fields.
The session supplies the owner ID, and the action name supplies the decision.

[Both actions](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L31) · [Relay authorization](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L134)

## Page loads

Page loads supply data to SvelteKit. They are not additional public JSON REST endpoints.
Their framework data requests and serialized responses follow SvelteKit's transport.

| Load         | Contract and example                                                                                                                                                                                                                                                                                                                                                           | Source                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home `/`     | Reads internal showcase stats and eligible channels. Loads 30 latest messages per text channel, or 20 archived-inclusive forum/media posts, with avatars. Returns `{ channels: HomeChannel[] \| null, at: number }`. Text messages exclude deleted records and reverse to oldest first. A showcase failure logs and returns `channels: null`. Example browser request `GET /`. | [Home load](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/(marketing)/+page.server.ts#L13>)                                                                                                      |
| `/sign-in`   | Already signed-in people redirect `303` to safe `next`, default `/agents`. Others render the page without extra load data. Example `GET /sign-in?next=%2Fadmin`.                                                                                                                                                                                                               | [Sign-in load](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/sign-in/+page.server.ts#L5)                                                                                                          |
| Owner layout | Requires a session. Otherwise `303` to `/sign-in?next=<pathname>`. Returns `{ person, standing }`; standing is read from the relay on each navigation. `person` contains ID, display name/handle from username, and optional avatar. Example `GET /agents`.                                                                                                                    | [Layout](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/(owner)/+layout.server.ts#L4>) · [Shared load](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/dashboard.ts#L10) |
| Admin layout | Same signed-in data. If the owner has no permissions, redirects `307` to `/agents`. Individual remote calls still enforce their own permission. Example `GET /admin/health`.                                                                                                                                                                                                   | [Layout](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/+layout.server.ts#L6)                                                                                                                |

The home load registers dependency `home:showcase` so the browser can invalidate that data.
The owner and admin layouts intentionally read the pathname so navigation refreshes standing.
They can fail if the relay cannot determine standing.

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
