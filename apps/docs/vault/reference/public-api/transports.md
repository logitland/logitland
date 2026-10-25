---
title: MCP transport and Logan OAuth endpoints
description: Agent and Logan MCP HTTP behavior, admin OAuth discovery, client registration, tokens, and revocation.
---

[Public API](index.md) · [MCP tools](../mcp/index.md)

## POST /mcp

Requires an active agent's `lat_` bearer token.
The token's scopes apply again when a tool calls its HTTP endpoint.
The request body is one JSON-RPC 2.0 message.
Send `Content-Type: application/json`.
An optional `Origin` must exactly equal the configured public origin.
Requests from other origins return `403`.

```sh
curl https://relay.example/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_delivery","arguments":{}}}'
```

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": "{\"kind\":\"none\"}" }], "structuredContent": { "kind": "none" } } }
```

HTTP success is `200`.
Agent authentication failures use the [standard problem response](index.md#errors).
See [MCP protocol](../mcp/index.md#protocol) for initialization, discovery, RPC errors, and notification behavior.
All [28 agent tools](../mcp/agent-tools.md) run through the same public API as HTTP requests.

Source: [route](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/mcp.ts#L16).

## Other methods on /mcp

`GET /mcp` and `DELETE /mcp` return `405`.
The catch-all also rejects `PUT`, `PATCH`, `OPTIONS`, and other non-POST methods.
These rejections do not require a token.
They have an empty body and `Allow: POST`.

```sh
curl -i https://relay.example/mcp
curl -i -X DELETE https://relay.example/mcp
```

Each response is:

```http
HTTP/1.1 405 Method Not Allowed
Allow: POST
```

There is no SSE stream or session deletion endpoint.
Source: [method-rejection handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/mcp.ts#L31).

## GET /.well-known/oauth-protected-resource/mcp/admin

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

## GET /.well-known/oauth-authorization-server/oauth2/admin

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
See [Logan tools](../mcp/logan-tools.md) for permission checks.

Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L60),
[authorization checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L111).

## POST /oauth2/admin/register

Registers a public MCP client without authentication.

| JSON field                   | Type and behavior                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `redirect_uris`              | Required array of 1–10 URL strings, each at most 2,048 characters, without fragments         |
| `client_name`                | Optional string; trimmed and truncated to 100 characters; defaults to `An MCP client`        |
| `token_endpoint_auth_method` | Optional; only `none` is accepted                                                            |
| `grant_types`                | Optional array containing only `authorization_code` and/or `refresh_token`; defaults to both |

Redirects allow HTTPS, HTTP on `localhost`, `127.0.0.1`, or `[::1]`, and non-refused custom URI schemes.
Plain HTTP elsewhere and browser-executable schemes are refused.
Loopback redirects can use a different port during authorization.
Other redirect components must match the registered URI.
Registration is limited to twenty per network per hour.

```sh
curl https://relay.example/oauth2/admin/register \
  -H 'Content-Type: application/json' \
  -d '{"client_name":"My assistant","redirect_uris":["http://127.0.0.1:8765/callback"],"token_endpoint_auth_method":"none"}'
```

Returns `201`:

```json
{
  "client_id": "lgc_01J00000000000000000000000",
  "client_id_issued_at": 1792929600,
  "client_name": "My assistant",
  "redirect_uris": ["http://127.0.0.1:8765/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

Invalid redirects return `400 invalid_redirect_uri`.
Other unsupported metadata returns `400 invalid_client_metadata`.
Limits return `429 rate_limited`.
Source: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L81),
[registration service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L75).

## POST /oauth2/admin/token

No bearer token or client secret.
Send form-encoded fields, or JSON whose values are strings.

| `grant_type`         | Required fields                                      |
| -------------------- | ---------------------------------------------------- |
| `authorization_code` | `code`, `client_id`, `redirect_uri`, `code_verifier` |
| `refresh_token`      | `refresh_token`, `client_id`                         |

```sh
curl https://relay.example/oauth2/admin/token \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'client_id=lgc_01J00000000000000000000000' \
  --data-urlencode "code=$AUTHORIZATION_CODE" \
  --data-urlencode 'redirect_uri=http://127.0.0.1:8765/callback' \
  --data-urlencode "code_verifier=$PKCE_VERIFIER"
```

Returns `200` with `Cache-Control: no-store`:

```json
{ "access_token": "lla_example", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "llr_example", "scope": "logan" }
```

Access tokens last one hour. Refresh tokens last thirty days and rotate on use.
A refresh request returns the same response shape with new tokens:

```sh
curl https://relay.example/oauth2/admin/token \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode 'client_id=lgc_01J00000000000000000000000' \
  --data-urlencode "refresh_token=$LOGAN_REFRESH_TOKEN"
```

Missing fields return `400 invalid_request`.
Unknown grants return `400 unsupported_grant_type`.
Expired codes/tokens, mismatched clients, redirects, or PKCE verifiers return `400 invalid_grant`.
Reusing a code or a revoked refresh token revokes its entire grant.
The exchange does not itself grant Discord permissions; MCP requests recheck them.

Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L86),
[exchange](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L188).

## POST /oauth2/admin/revoke

No authentication.
Optional form or JSON string field `token`.
An access token revokes itself; a refresh token revokes the entire grant.
Absent and unknown tokens also succeed.

```sh
curl -i https://relay.example/oauth2/admin/revoke --data-urlencode "token=$LOGAN_REFRESH_TOKEN"
```

```http
HTTP/1.1 200 OK
```

The response body is empty.
Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L91),
[revocation](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L243).

## POST /mcp/admin

Requires the person's Logan `lla_` bearer token, not an agent's `lat_` token.
The owner must remain in the Discord guild and hold the relay's `logan` admin permission.
Each HTTP request reloads Discord membership and standing.
Each person may make sixty MCP requests per minute.
An optional `Origin` must exactly equal the configured public origin.

```sh
curl https://relay.example/mcp/admin \
  -H "Authorization: Bearer $LOGAN_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_operations","arguments":{"query":"delete a channel","method":"DELETE"}}}'
```

Example result when no operation is available:

```json
{ "jsonrpc": "2.0", "id": 2, "result": { "content": [{ "type": "text", "text": "{\"operations\":[]}" }], "structuredContent": { "operations": [] } } }
```

Success uses the [same MCP protocol](../mcp/index.md#protocol) as the agent server.
The server name is `logan`.
The [four Logan tools](../mcp/logan-tools.md) discover, describe, execute, and track Discord catalog operations.
No catalog operation becomes a separately registered MCP tool.

An invalid token returns `401` and
`WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource/mcp/admin", scope="logan"`.
Missing standing or a foreign origin returns `403`.
Limits return `429`.
Unavailable Discord role checks return `503`.
Authentication and role failures occur before JSON-RPC handling.

Sources: [route](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L98),
[caller loading](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L70).

## Other methods on /mcp/admin

`GET /mcp/admin` and `DELETE /mcp/admin` return `405`.
The catch-all rejects all other non-POST methods too.
No token is required.
There is no SSE stream or session deletion endpoint.

```sh
curl -i https://relay.example/mcp/admin
curl -i -X DELETE https://relay.example/mcp/admin
```

Each response has an empty body:

```http
HTTP/1.1 405 Method Not Allowed
Allow: POST
```

Source: [method-rejection handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L112).
