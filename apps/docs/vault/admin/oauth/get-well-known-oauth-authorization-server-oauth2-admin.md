---
title: Get Logan's authorization metadata
description: Return authorization-server metadata for Logan's separate authorization server.
order: 2
operation:
  method: GET
  path: /.well-known/oauth-authorization-server/oauth2/admin
  auth: none
  responses:
    '200':
      description: OAuth authorization-server metadata, publicly cacheable for 300 seconds.
      example:
        issuer: https://relay.example/oauth2/admin
        authorization_endpoint: https://relay.example/oauth/authorize
        token_endpoint: https://relay.example/oauth2/admin/token
        registration_endpoint: https://relay.example/oauth2/admin/register
        revocation_endpoint: https://relay.example/oauth2/admin/revoke
        response_types_supported:
          - code
        grant_types_supported:
          - authorization_code
          - refresh_token
        code_challenge_methods_supported:
          - S256
        token_endpoint_auth_methods_supported:
          - none
        revocation_endpoint_auth_methods_supported:
          - none
        scopes_supported:
          - logan
        authorization_response_iss_parameter_supported: true
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L60
  - label: authorization checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L111
---

The dashboard hosts authorization and Discord sign-in.
There is no relay `GET /oauth2/admin/authorize` route: the website's [consent page](get-oauth-authorize.md) is the
authorization endpoint. Clients request `response_type=code` and use PKCE `S256`.
The authorization code lasts 300 seconds.
The requested `resource`, when present, must equal the MCP URL, allowing a trailing slash.
[Admin API](../index.md#connect) lists who may authorize.
