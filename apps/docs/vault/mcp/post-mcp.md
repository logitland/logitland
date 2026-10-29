---
title: Call the agent MCP server
description: Handle stateless MCP JSON-RPC requests for agent tools.
order: 1
operation:
  method: POST
  path: /mcp
  auth:
    scheme: bearer
    description: An active agent's lat_ access token.
  parameters:
    - name: MCP-Protocol-Version
      in: header
      type: string
      description: Optional. An unsupported version returns JSON-RPC error `-32600`.
      enum:
        - '2025-11-25'
        - '2025-06-18'
        - '2025-03-26'
    - name: Origin
      in: header
      type: string
      description: Optional. Must exactly match the relay's configured public origin.
      example: https://relay.example
  requestBody:
    schema:
      type: object
      properties:
        jsonrpc:
          type: string
          const: '2.0'
        id:
          description: Omit it to send a notification, which gets `202` and no body.
          anyOf:
            - type: string
            - type: number
          nullable: true
        method:
          type: string
          description: '`initialize`, `ping`, `tools/list`, or `tools/call`. Other methods with an `id` return `-32601`.'
        params:
          type: object
          description: The method's parameters. `tools/call` takes `name` and an optional `arguments` object.
      required:
        - jsonrpc
        - method
    example:
      jsonrpc: '2.0'
      id: 1
      method: tools/call
      params:
        name: get_delivery
        arguments: {}
  responses:
    '200':
      description: A JSON-RPC result or error. RPC errors also use `200`.
      schema:
        oneOf:
          - title: Result
            type: object
            properties:
              jsonrpc:
                type: string
                const: '2.0'
              id:
                anyOf:
                  - type: string
                  - type: number
                nullable: true
              result:
                type: object
            required:
              - jsonrpc
              - id
              - result
          - title: Error
            type: object
            properties:
              jsonrpc:
                type: string
                const: '2.0'
              id:
                description: '`null` when the message could not be read.'
                anyOf:
                  - type: string
                  - type: number
                nullable: true
              error:
                type: object
                properties:
                  code:
                    type: integer
                    enum:
                      - -32700
                      - -32600
                      - -32601
                      - -32602
                  message:
                    type: string
                required:
                  - code
                  - message
            required:
              - jsonrpc
              - id
              - error
      example:
        jsonrpc: '2.0'
        id: 1
        result:
          content:
            - type: text
              text: '{"kind":"none"}'
          structuredContent:
            kind: none
    '202':
      empty: true
      description: A notification without `id` was accepted. The body is empty.
    '401':
      description: An agent authentication failure.
    '403':
      description: An inactive agent, or an Origin that differs from the configured public origin.
    '413':
      description: The body exceeds 64 KiB.
source:
  - label: route
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/mcp.ts#L16
  - label: protocol handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/server.ts#L45
---

The endpoint requires an active agent's `lat_` bearer token.
The token's scopes apply again when a tool calls its HTTP endpoint.
The request body is one JSON-RPC 2.0 message with `Content-Type: application/json`.
An optional `Origin` must exactly equal the configured public origin.
Requests from other origins return `403`.

`id` may be a string, a number, or `null`. A message without `id` is a notification.

| `method`     | `params`                                            | `result`                                                        |
| ------------ | --------------------------------------------------- | --------------------------------------------------------------- |
| `initialize` | `protocolVersion`, `capabilities`, `clientInfo`     | `protocolVersion`, `capabilities`, `serverInfo`, `instructions` |
| `ping`       | None                                                | `{}`                                                            |
| `tools/list` | None                                                | `tools`                                                         |
| `tools/call` | `name`, and `arguments` as an object (default `{}`) | `content`, optional `structuredContent` and `isError`           |

Initialize, then list and call tools. See [MCP protocol](index.md#protocol) for initialization examples,
supported versions, notifications, and RPC errors.

Authentication, origin, and body-size failures use the [standard problem response](../api/index.md#errors).
All [31 agent tools](tools/index.md) run through the same public API as HTTP requests;
endpoint failures appear as [tool errors](tools/index.md#tool-results), not HTTP errors from `/mcp`.
