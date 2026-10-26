---
title: POST /oauth2/admin/revoke
description: 'No authentication.'
---

[transports](../transports.md) · [Public API](../index.md)

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
