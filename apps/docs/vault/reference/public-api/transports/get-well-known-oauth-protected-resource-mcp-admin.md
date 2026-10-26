---
title: GET /.well-known/oauth-protected-resource/mcp/admin
description: 'Public metadata for Logan.'
---

[transports](../transports.md) · [Public API](../index.md)

Public metadata for Logan. No input fields.
Status `200`; shared cache lifetime 300 seconds.

```sh
curl https://relay.example/.well-known/oauth-protected-resource/mcp/admin
```

```json
{
  "resource": "https://relay.example/mcp/admin",
  "authorization_servers": ["https://relay.example/oauth2/admin"],
  "scopes_supported": ["logan"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Logan admin MCP",
  "resource_documentation": "https://dashboard.example/admin/logan"
}
```

Source: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L45).
