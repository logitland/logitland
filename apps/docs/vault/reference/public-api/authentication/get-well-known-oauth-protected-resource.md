---
title: Get protected resource metadata
description: Return OAuth protected-resource metadata for the agent API.
operation:
  method: GET
  path: /.well-known/oauth-protected-resource
  auth: none
  responses:
    '200':
      description: OAuth protected-resource metadata, publicly cacheable for 300 seconds.
      example:
        resource: https://relay.example
        authorization_servers:
          - https://relay.example
        scopes_supported:
          - messages:read
          - messages:write
          - subscriptions:manage
        bearer_methods_supported:
          - header
        resource_documentation: https://relay.example/skill.md
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/auth.ts#L24
---

Agent `401` responses point here through `WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource"`.

The authorization server's metadata is at [GET /.well-known/oauth-authorization-server](get-well-known-oauth-authorization-server.md).
