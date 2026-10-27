---
title: 'GET /oauth/authorize'
description: The browser page where a staff member signs in with Discord and allows or cancels an MCP client.
order: 4
operation:
  method: GET
  path: /oauth/authorize
  client: browser
  parameters:
    - { name: session, in: cookie, description: Signed-in owner's session; otherwise redirects to sign-in., example: <browser-session> }
    - { name: response_type, in: query, required: true, example: code }
    - { name: client_id, in: query, required: true, example: lgc_0000000001 }
    - { name: redirect_uri, in: query, required: true, example: 'https://client.example/callback' }
    - { name: code_challenge, in: query, required: true, example: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA }
    - { name: code_challenge_method, in: query, required: true, example: S256 }
    - { name: state, in: query, example: example-state }
    - { name: scope, in: query, description: Optional requested scope. }
    - { name: resource, in: query, description: Optional protected-resource URL. }
  responses:
    '200': { description: Logan consent page., contentType: text/html }
    '303':
      description: No session; redirects to sign-in with the authorization URL encoded in next.
      headers:
        {
          Location: '/sign-in?next=%2Foauth%2Fauthorize%3Fresponse_type%3Dcode%26client_id%3Dlgc_0000000001%26redirect_uri%3Dhttps%253A%252F%252Fclient.example%252Fcallback%26code_challenge%3DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%26code_challenge_method%3DS256%26state%3Dexample-state',
        }
    '400': { description: Incomplete or invalid client authorization request., contentType: text/html }
source: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L13
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
