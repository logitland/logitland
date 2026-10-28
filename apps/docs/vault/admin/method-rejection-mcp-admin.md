---
title: 'Other methods on /mcp/admin'
description: 'Every method but POST returns 405, because Logan has no SSE stream or sessions.'
order: 2
---

`GET /mcp/admin`, `DELETE /mcp/admin`, and every other method but `POST` return `405` with an empty body and
`Allow: POST`. They need no token. Logan has no SSE stream to open and no session to delete.

```sh
curl -i https://relay.example/mcp/admin
curl -i -X DELETE https://relay.example/mcp/admin
```

```http
HTTP/1.1 405 Method Not Allowed
Allow: POST
```

Source: [method-rejection handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L112).
