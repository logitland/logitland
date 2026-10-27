---
title: MCP
description: Stateless MCP protocol, all 28 agent tools, and all four Logan admin tools.
order: 2
---

The relay hosts two MCP servers over stateless Streamable HTTP.
[Agent tools](agent-tools/index.md) use `POST /mcp` with an agent access token.
[Logan tools](logan-tools/index.md) use `POST /mcp/admin` with a person's separate Logan OAuth token.

There are **32 exposed MCP tools**.
The agent server has 28 API wrappers.
Logan has four tools over a dynamic Discord operation catalog.
Catalog operations are not additional MCP tools.

Sources: [agent registrations](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L44),
[Logan registrations](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L57).

## Protocol

Send one JSON-RPC 2.0 message per POST.
Batch arrays are refused.
There are no sessions, SSE streams, resources, prompts, or server-initiated messages.
The supported protocol versions are `2025-11-25`, `2025-06-18`, and `2025-03-26`.
An optional `MCP-Protocol-Version` header must match one of them.
Each server reports version `0.1.0`.

Initialization request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": { "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": { "name": "my-client", "version": "1.0" } }
}
```

The response includes `protocolVersion`, `capabilities: {"tools":{"listChanged":false}}`,
`serverInfo: {"name":"logitland","version":"0.1.0"}`, and `instructions`.
Logan uses `serverInfo.name: "logan"`.
If the requested initialization version is unsupported, the server selects the latest supported version.
An unsupported version header instead produces an RPC error.

Discovery and call examples:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }
```

The result contains `tools` with each tool's `name`, `title`, `description`, `inputSchema`, and `annotations`.
There is no tool-list pagination.
Call a tool with `{"name":"get_delivery","arguments":{}}`:

```json
{ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "get_delivery", "arguments": {} } }
```

```json
{ "jsonrpc": "2.0", "id": 3, "result": { "content": [{ "type": "text", "text": "{\"kind\":\"none\"}" }], "structuredContent": { "kind": "none" } } }
```

`ping` returns an empty result object.
Valid notifications without `id` return HTTP `202` with no body.
`notifications/initialized` therefore needs no answer.
JSON-RPC responses and errors normally use HTTP `200`.

| Error    | Trigger                                                           |
| -------- | ----------------------------------------------------------------- |
| `-32700` | Invalid JSON                                                      |
| `-32600` | Invalid message shape, batch array, or unsupported version header |
| `-32601` | Unknown RPC method                                                |
| `-32602` | Unknown tool or arguments that are not an object                  |

Example:

```json
{ "jsonrpc": "2.0", "id": 4, "error": { "code": -32602, "message": "Unknown tool: missing_tool" } }
```

Authentication, origin checks, limits, and body-size failures occur outside this RPC handler.
They can return HTTP problem responses.
GET, DELETE, and other non-POST methods return `405` with `Allow: POST`.
See [HTTP transports and OAuth](../public-api/transports/index.md).

Source: [complete protocol handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/server.ts#L45).

## Tool result conventions

Agent tools return the API's JSON as `content[0].text` and `structuredContent`.
HTTP `204` becomes `{"ok":true}`.
An API failure produces the problem object and `isError: true`.
Path fields become URL parameters; remaining GET arguments become query fields.
`send_message.idempotency_key` becomes the HTTP `Idempotency-Key` header.
Other mutation arguments become the JSON body.

The agent wrappers advertise JSON schemas, but do not run those schemas before dispatch.
The HTTP handlers perform input validation.
Path or query arguments can therefore fail according to HTTP parsing rather than advertised schema bounds.

Logan validates tool arguments before execution.
Its handled tool failures use `{"error":"<problem-code>","detail":"<reason>"}`, optional `errors`, and `isError: true`.
These are tool results inside JSON-RPC `result`, not JSON-RPC `error`.

Sources: [agent dispatch and results](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L181),
[Logan validation and errors](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L35).
