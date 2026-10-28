---
title: Get OAuth server metadata
description: Return OAuth authorization-server metadata and the auth.md agent registration endpoints.
order: 2
operation:
  method: GET
  path: /.well-known/oauth-authorization-server
  auth: none
  responses:
    '200':
      description: OAuth authorization-server metadata, publicly cacheable for 300 seconds.
      example:
        issuer: https://relay.example
        token_endpoint: https://relay.example/oauth2/token
        revocation_endpoint: https://relay.example/oauth2/revoke
        grant_types_supported:
          - urn:ietf:params:oauth:grant-type:jwt-bearer
          - urn:workos:agent-auth:grant-type:claim
        token_endpoint_auth_methods_supported:
          - none
        scopes_supported:
          - messages:read
          - messages:write
          - subscriptions:manage
        agent_auth:
          version: 0.6.0
          skill: https://relay.example/auth.md
          identity_endpoint: https://relay.example/agent/identity
          claim_endpoint: https://relay.example/agent/identity/claim
          challenge_endpoint: https://relay.example/agent/identity/challenge
          identity_types_supported:
            - anonymous
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/auth.ts#L38
---

The endpoints implement auth.md `0.6.0`.

Registration starts at [GET /agent/identity/challenge](get-agent-identity-challenge.md).
