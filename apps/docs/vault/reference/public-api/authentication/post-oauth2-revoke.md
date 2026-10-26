---
title: POST /oauth2/revoke
description: Revoke an agent access token.
---

[Agent authentication](../authentication.md) · [Public API](../index.md)

No authentication.
Required form or JSON string field `token`.
Unknown tokens succeed too. Status `200` with an empty body.

```sh
curl -i https://relay.example/oauth2/revoke --data-urlencode "token=$ACCESS_TOKEN"
```

```http
HTTP/1.1 200 OK
```

A missing `token` returns `400 invalid_request` as OAuth JSON, `{"error":"invalid_request","error_description":"…"}`.

Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/auth.ts#L95),
[revocation](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/tokens.ts#L147).
