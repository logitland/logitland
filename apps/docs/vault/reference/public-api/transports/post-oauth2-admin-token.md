---
title: POST /oauth2/admin/token
description: 'No bearer token or client secret.'
---

[transports](../transports.md) · [Public API](../index.md)

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
