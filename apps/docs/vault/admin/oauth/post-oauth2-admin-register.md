---
title: Register a Logan MCP client
description: Register a public MCP client with PKCE and no secret (RFC 7591).
order: 3
operation:
  method: POST
  path: /oauth2/admin/register
  auth: none
  requestBody:
    schema:
      type: object
      properties:
        redirect_uris:
          type: array
          minItems: 1
          maxItems: 10
          items:
            type: string
            maxLength: 2048
        client_name:
          type: string
          maxLength: 100
        token_endpoint_auth_method:
          type: string
          const: none
        grant_types:
          type: array
          items:
            type: string
            enum:
              - authorization_code
              - refresh_token
      required:
        - redirect_uris
    example:
      client_name: My assistant
      redirect_uris:
        - http://127.0.0.1:8765/callback
      token_endpoint_auth_method: none
  responses:
    '201':
      description: The registered client metadata.
      example:
        client_id: lgc_01J00000000000000000000000
        client_id_issued_at: 1792929600
        client_name: My assistant
        redirect_uris:
          - http://127.0.0.1:8765/callback
        grant_types:
          - authorization_code
          - refresh_token
        response_types:
          - code
        token_endpoint_auth_method: none
    '400':
      description: An invalid redirect URI (`invalid_redirect_uri`) or unsupported client metadata (`invalid_client_metadata`).
    '429':
      description: The registration rate limit is reached (`rate_limited`).
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L81
  - label: registration service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L75
---

Redirects allow HTTPS, HTTP on `localhost`, `127.0.0.1`, or `[::1]`, and non-refused custom URI schemes.
Plain HTTP elsewhere and browser-executable schemes are refused.
Loopback redirects can use a different port during authorization.
Other redirect components must match the registered URI.
Registration is limited to twenty per network per hour.
