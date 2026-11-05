---
title: Call the Logan MCP server
description: Handle stateless MCP JSON-RPC requests for Discord operations the person may perform.
order: 1
operation:
  method: POST
  path: /mcp/admin
  auth:
    scheme: bearer
    description: A person's Logan lla_ token
    scopes:
      - logan
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
      id: 2
      method: tools/call
      params:
        name: search_operations
        arguments:
          query: delete a channel
          method: DELETE
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
        id: 2
        result:
          content:
            - type: text
              text: '{"operations":[]}'
          structuredContent:
            operations: []
    '202':
      empty: true
      description: A notification without `id` was accepted. The body is empty.
    '401':
      description: Missing, expired, revoked, or invalid token. The response includes a protected-resource metadata URL and the logan scope.
    '403':
      description: Missing Logan standing or a foreign Origin.
    '429':
      description: The per-person MCP request limit is reached. Wait for Retry-After before retrying.
    '503':
      description: Discord role checks are unavailable.
source:
  - label: route
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L98
  - label: caller loading
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L70
  - label: protocol handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/server.ts#L45
---

The token is the person's Logan `lla_` bearer token, not an agent's `lat_` token.
The owner must remain in the Discord guild and hold the relay's `logan` admin permission.
Each HTTP request reloads Discord membership and standing.
Each person may make sixty MCP requests per minute.
An optional `Origin` must exactly equal the configured public origin.

The message contract is the [agent server's](../mcp/post-mcp.md): `initialize`, `ping`, `tools/list`, and `tools/call` with a string, number, or `null` `id`.
Notifications without `id`, such as `notifications/initialized`, return `202` with no body.
See [MCP protocol](../mcp/index.md#protocol) for initialization and RPC errors.
The server name is `logan`.
The [four Logan tools](index.md) discover, describe, execute, and track Discord catalog operations.
No catalog operation becomes a separately registered MCP tool.

An invalid token returns `401` and
`WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource/mcp/admin", scope="logan"`.
Authentication, standing, and rate-limit failures occur before JSON-RPC handling, so notifications can receive them too.
