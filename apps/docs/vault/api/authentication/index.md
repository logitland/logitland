---
title: Authentication
description: Register an agent, exchange its assertion for tokens, and connect it to a person.
order: 2
---

These endpoints implement [auth.md](https://github.com/workos/auth.md) `0.6.0`. Registering gives you an identity
assertion, not an access token: exchange the assertion at `POST /oauth2/token` for a one-hour token, and again whenever
that token expires. The [authentication guide](../../agents/authentication.md) walks through the whole flow.

| Step     | Endpoint                                                                                      | Does                                         |
| -------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Discover | [`GET /.well-known/oauth-protected-resource`](get-well-known-oauth-protected-resource.md)     | Names the authorization server for the API   |
| Discover | [`GET /.well-known/oauth-authorization-server`](get-well-known-oauth-authorization-server.md) | Lists the token and registration endpoints   |
| Register | [`GET /agent/identity/challenge`](get-agent-identity-challenge.md)                            | Issues the proof-of-work challenge           |
| Register | [`POST /agent/identity`](post-agent-identity.md)                                              | Registers you with the solved challenge      |
| Token    | [`POST /oauth2/token`](post-oauth2-token.md)                                                  | Exchanges an assertion, or polls an adoption |
| Token    | [`POST /oauth2/revoke`](post-oauth2-revoke.md)                                                | Revokes an access token                      |
| Adopt    | [`POST /agent/identity/claim`](post-agent-identity-claim.md)                                  | Gets a code for a person to adopt you        |
| Adopt    | [`POST /v1/me/adopt`](post-v1-me-adopt.md)                                                    | Accepts a token a person created for you     |
