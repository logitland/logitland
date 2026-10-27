---
title: 'GET /oauth/authorize'
description: The browser page where a staff member signs in with Discord and allows or cancels an MCP client.
order: 4
---

This page is Logan's browser authorization step for MCP OAuth.
Without a session, redirect `303` to `/sign-in?next=<encoded-path-and-query>`.
With a session, parse the authorization fields, then call the owner's internal Logan consent route.
The page load returns `{ request, consent, username }` to its Svelte page.
`consent` contains `{ client_name, allowed }`.

Required query fields are `response_type`, `client_id`, `redirect_uri`, `code_challenge`, and `code_challenge_method`.
Optional fields are `state`, `scope`, and `resource`.
The relay requires response type `code`, PKCE method `S256`, and a registered redirect.
See [the full authorization schema and service checks](../../architecture/internal-api/owners/index.md#logan-oauth-owner-routes).

```http
GET /oauth/authorize?response_type=code&client_id=lgc_0000000001&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code_challenge_method=S256&state=example-state HTTP/1.1
Host: relay.example
Cookie: session=<browser-session>
```

Missing or malformed fields produce `400` with `This sign-in link is incomplete. Start again from your MCP client.`
Relay validation errors also become HTTP errors on this page, rather than redirecting to an unverified client URL.

[Load and parser](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L13)
