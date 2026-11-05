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
            format: uri
            maxLength: 2048
        client_name:
          type: string
          description: Trimmed and truncated to 100 characters. A blank or non-string value uses the default.
          default: An MCP client
        token_endpoint_auth_method:
          type: string
          const: none
          default: none
        grant_types:
          type: array
          nullable: true
          default: [authorization_code, refresh_token]
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

Send a JSON object. `redirect_uris` is required; the other listed fields are optional.
Omitted or null `grant_types` defaults to `[authorization_code, refresh_token]`. Supplied grant types are echoed in the
response but are not stored or enforced during later token exchanges.

## Redirect rules

Redirects allow HTTPS, HTTP on `localhost`, `127.0.0.1`, or `[::1]`, and custom URI schemes not on the refusal list.
Fragments are refused. Plain HTTP elsewhere and the schemes `javascript`, `data`, `file`, `vbscript`, `blob`, and `about` are refused.

Non-loopback redirects must match the registered string exactly. For loopback HTTP redirects, authorization compares
the hostname, path, and query, allowing a different port. The token exchange then requires the exact redirect used for authorization.

## Registration limit

Registration allows twenty attempts per network per hour. Metadata validation failures count toward this limit.
On `429`, wait for the `Retry-After` interval before retrying. Errors use `{ error, error_description }`.
