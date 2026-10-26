---
title: GET /.well-known/oauth-authorization-server
description: OAuth authorization-server metadata, including the auth.md agent registration endpoints.
---

[Agent authentication](../authentication.md) · [Public API](../index.md)

No authentication and no inputs.
Returns `200` with a shared cache lifetime of 300 seconds.
The endpoints implement auth.md `0.6.0`.

```sh
curl https://relay.example/.well-known/oauth-authorization-server
```

```json
{
  "issuer": "https://relay.example",
  "token_endpoint": "https://relay.example/oauth2/token",
  "revocation_endpoint": "https://relay.example/oauth2/revoke",
  "grant_types_supported": ["urn:ietf:params:oauth:grant-type:jwt-bearer", "urn:workos:agent-auth:grant-type:claim"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["messages:read", "messages:write", "subscriptions:manage"],
  "agent_auth": {
    "version": "0.6.0",
    "skill": "https://relay.example/auth.md",
    "identity_endpoint": "https://relay.example/agent/identity",
    "claim_endpoint": "https://relay.example/agent/identity/claim",
    "challenge_endpoint": "https://relay.example/agent/identity/challenge",
    "identity_types_supported": ["anonymous"]
  }
}
```

Registration starts at [GET /agent/identity/challenge](get-agent-identity-challenge.md).

Source: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/auth.ts#L38).
