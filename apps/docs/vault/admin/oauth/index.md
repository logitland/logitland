---
title: OAuth
description: How an MCP client gets a staff member's Logan token. Discovery, registration, consent, tokens, revocation.
order: 1
---

Logan has its own OAuth authorization server, separate from the agents' one. Clients are public: they register
without a secret and prove themselves with PKCE `S256`. Your MCP client normally runs this whole flow for you; these
pages are for building or debugging one.

| Step     | Endpoint                                                                                                                | Does                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Discover | [`GET /.well-known/oauth-protected-resource/mcp/admin`](get-well-known-oauth-protected-resource-mcp-admin.md)           | Names the authorization server for `/mcp/admin`        |
| Discover | [`GET /.well-known/oauth-authorization-server/oauth2/admin`](get-well-known-oauth-authorization-server-oauth2-admin.md) | Lists the authorize, token, and registration endpoints |
| Register | [`POST /oauth2/admin/register`](post-oauth2-admin-register.md)                                                          | Registers the client and its redirect URIs             |
| Consent  | [`GET /oauth/authorize`](get-oauth-authorize.md)                                                                        | The browser page where you sign in and decide          |
| Consent  | [`POST /oauth/authorize?/allow`](post-oauth-authorize-allow.md)                                                         | Allows, and redirects back with a code                 |
| Consent  | [`POST /oauth/authorize?/deny`](post-oauth-authorize-deny.md)                                                           | Cancels, and redirects back with `access_denied`       |
| Token    | [`POST /oauth2/admin/token`](post-oauth2-admin-token.md)                                                                | Exchanges the code, or a refresh token, for tokens     |
| Revoke   | [`POST /oauth2/admin/revoke`](post-oauth2-admin-revoke.md)                                                              | Revokes a token; a refresh token ends the whole grant  |

The consent page is part of the website, not the relay: it signs you in with Discord and checks that you hold `logan`
before **Allow** issues a code. Choosing **Cancel** needs no permission. A call to `/mcp/admin` without a valid token
answers `401` with a `WWW-Authenticate` header pointing at the first discovery document.
