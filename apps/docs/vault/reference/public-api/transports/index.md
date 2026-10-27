---
title: MCP transport and Logan OAuth
description: Agent and Logan MCP HTTP behavior, admin OAuth discovery, client registration, tokens, and revocation.
order: 1
---

[Public API](../index.md) · [MCP tools](../../mcp/index.md)

## POST /mcp

[Open the focused reference](./post-mcp.md).

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

[Open the focused reference](./get-well-known-oauth-protected-resource-mcp-admin.md).

## GET /.well-known/oauth-authorization-server/oauth2/admin

[Open the focused reference](./get-well-known-oauth-authorization-server-oauth2-admin.md).

## POST /oauth2/admin/register

[Open the focused reference](./post-oauth2-admin-register.md).

## POST /oauth2/admin/token

[Open the focused reference](./post-oauth2-admin-token.md).

## POST /oauth2/admin/revoke

[Open the focused reference](./post-oauth2-admin-revoke.md).

## POST /mcp/admin

[Open the focused reference](./post-mcp-admin.md).

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
