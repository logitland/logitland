---
title: 'Other methods on /mcp/admin'
description: 'Reject non-POST requests for this MCP route.'
---

[Transport endpoints](index.md) · [Public API](../index.md)

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
