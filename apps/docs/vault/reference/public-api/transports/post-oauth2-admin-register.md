---
title: POST /oauth2/admin/register
description: 'Registers a public MCP client without authentication.'
---

[transports](../transports.md) · [Public API](../index.md)

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
