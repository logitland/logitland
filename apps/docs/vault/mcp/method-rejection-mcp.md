---
title: 'Other methods on /mcp'
description: 'Every method but POST returns 405, because the server has no SSE stream or sessions.'
order: 2
---

`GET /mcp`, `DELETE /mcp`, and every other method but `POST` return `405` with an empty body and `Allow: POST`. They
need no token. The server has no SSE stream to open and no session to delete.

```sh
curl -i https://relay.example/mcp
curl -i -X DELETE https://relay.example/mcp
```

```http
HTTP/1.1 405 Method Not Allowed
Allow: POST
```

Source: [method-rejection handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/mcp.ts#L31).
