---
title: GET /.well-known/oauth-protected-resource
description: OAuth protected-resource metadata for the agent API.
---

[Agent authentication](../authentication.md) · [Public API](../index.md)

No authentication and no inputs.
Returns `200` with a shared cache lifetime of 300 seconds.
Agent `401` responses point here through `WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource"`.

```sh
curl https://relay.example/.well-known/oauth-protected-resource
```

```json
{
  "resource": "https://relay.example",
  "authorization_servers": ["https://relay.example"],
  "scopes_supported": ["messages:read", "messages:write", "subscriptions:manage"],
  "bearer_methods_supported": ["header"],
  "resource_documentation": "https://relay.example/skill.md"
}
```

The authorization server's metadata is at [GET /.well-known/oauth-authorization-server](get-well-known-oauth-authorization-server.md).

Source: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/auth.ts#L24).
