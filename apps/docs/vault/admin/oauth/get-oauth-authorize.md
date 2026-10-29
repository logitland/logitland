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
    - { name: response_type, in: query, required: true, description: Must be code., example: code }
    - { name: client_id, in: query, required: true, description: Registered client ID; at most 64 characters., example: lgc_0000000001 }
    - {
        name: redirect_uri,
        in: query,
        required: true,
        description: Must match registration; at most 2048 characters.,
        example: 'https://client.example/callback',
      }
    - {
        name: code_challenge,
        in: query,
        required: true,
        description: PKCE challenge; 43–128 base64url characters.,
        example: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA,
      }
    - { name: code_challenge_method, in: query, required: true, description: Must be S256., example: S256 }
    - { name: state, in: query, description: At most 1024 characters; returned in the client redirect., example: example-state }
    - { name: scope, in: query, description: At most 256 characters; accepted but not used to select scopes. Tokens always carry logan. }
    - { name: resource, in: query, description: At most 2048 characters; must equal the Logan MCP URL, allowing one trailing slash. }
  responses:
    '200': { description: Logan consent page., contentType: text/html }
    '303':
      description: No session; redirects to sign-in with the authorization URL encoded in next.
      headers:
        {
          Location: '/sign-in?next=%2Foauth%2Fauthorize%3Fresponse_type%3Dcode%26client_id%3Dlgc_0000000001%26redirect_uri%3Dhttps%253A%252F%252Fclient.example%252Fcallback%26code_challenge%3DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%26code_challenge_method%3DS256%26state%3Dexample-state',
        }
    '400': { description: Incomplete or invalid client authorization request., contentType: text/html }
source:
  - https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L13
  - https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1485
  - https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L111
---

This page is Logan's browser authorization step for MCP OAuth.
Without a session, the page redirects `303` to `/sign-in?next=<encoded-path-and-query>`.
With a session, it validates the client request through the owner's [internal consent route](../../architecture/internal-api/owners/post-logan-consent.md).
The page shows the client name and offers **Allow** only when the owner holds the relay's `logan` admin permission.
**Cancel** remains available without that permission.

Use the authorization fields sent by the MCP client, including its actual registered ID, redirect, and PKCE challenge;
the examples are placeholders. For redirect matching, see [client registration](post-oauth2-admin-register.md).

Missing or malformed fields produce `400` with `This sign-in link is incomplete. Start again from your MCP client.`
Relay validation errors also become HTTP errors on this page, rather than redirecting to an unverified client URL.
