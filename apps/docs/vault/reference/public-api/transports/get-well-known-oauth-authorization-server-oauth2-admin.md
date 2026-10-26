---
title: GET /.well-known/oauth-authorization-server/oauth2/admin
description: "Public metadata for Logan's separate authorization server."
---

[transports](../transports.md) · [Public API](../index.md)

Public metadata for Logan's separate authorization server.
No input fields. Status `200`; shared cache lifetime 300 seconds.

```sh
curl https://relay.example/.well-known/oauth-authorization-server/oauth2/admin
```

```json
{
  "issuer": "https://relay.example/oauth2/admin",
  "authorization_endpoint": "https://dashboard.example/oauth/authorize",
  "token_endpoint": "https://relay.example/oauth2/admin/token",
  "registration_endpoint": "https://relay.example/oauth2/admin/register",
  "revocation_endpoint": "https://relay.example/oauth2/admin/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["logan"],
  "authorization_response_iss_parameter_supported": true
}
```

The dashboard hosts authorization and Discord sign-in.
There is no relay `GET /oauth2/admin/authorize` route.
Clients request `response_type=code` and use PKCE `S256`.
The authorization code lasts 300 seconds.
The requested `resource`, when present, must equal the MCP URL, allowing a trailing slash.
See [Logan tools](../../mcp/logan-tools.md) for permission checks.

Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L60),
[authorization checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L111).
