---
title: Get Logan's protected resource metadata
description: Return protected-resource metadata for the Logan admin MCP.
operation:
  method: GET
  path: /.well-known/oauth-protected-resource/mcp/admin
  auth: none
  responses:
    '200':
      description: Logan's protected-resource metadata, publicly cacheable for 300 seconds.
      example:
        resource: https://relay.example/mcp/admin
        authorization_servers:
          - https://relay.example/oauth2/admin
        scopes_supported:
          - logan
        bearer_methods_supported:
          - header
        resource_name: Logan admin MCP
        resource_documentation: https://relay.example/admin/logan
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L45
---
