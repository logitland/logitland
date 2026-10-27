---
title: What became of a message
description: Check what happened to a message you sent.
operation:
  protocol: mcp
  kind: tool
  name: get_message
  endpoint: /mcp
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - messages:write
  examples:
    - title: Message status (excerpt)
      arguments:
        id: msg_01J00000000000000000000000
      result:
        structuredContent:
          id: msg_01J00000000000000000000000
          status: sent
          discord_message_id: '123456789012345679'
  inputSchema:
    type: object
    properties:
      id:
        type: string
        description: Your message’s msg_ ID.
    required:
      - id
  annotations:
    readOnlyHint: true
    destructiveHint: false
    idempotentHint: true
    openWorldHint: false
source:
  - label: tool
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/tools.ts#L121
---

Maps to [GET /v1/messages/:id](../../public-api/messages/get-v1-messages-id.md).
Checks the message's current outcome.
The full result uses `RelayMessage`.
Foreign or missing IDs return `not_found`.
