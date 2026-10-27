---
title: 'Other methods on /mcp'
description: 'Reject non-POST requests for this MCP route.'
---

[Transport endpoints](index.md) · [Public API](../index.md)

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
