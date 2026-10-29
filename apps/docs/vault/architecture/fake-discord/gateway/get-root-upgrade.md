---
title: 'GET / WebSocket upgrade'
description: Fake Discord Gateway WebSocket upgrade path at the root URL.
operation:
  protocol: websocket
  path: /
  server: http://127.0.0.1:8790
  auth: { scheme: none, description: IDENTIFY and RESUME authenticate in frames after the upgrade. }
  parameters:
    - { name: v, in: query, required: true, description: API version 9 or 10., example: 10 }
    - { name: encoding, in: query, description: Only json is supported; defaults to json., example: json }
  responses:
    '101': { description: Switching Protocols; valid Gateway query parameters receive HELLO, otherwise a close frame. }
    '400': { description: Invalid WebSocket handshake., empty: true }
  messages:
    - direction: receive
      name: HELLO
      description: Opcode 10 announces the configured heartbeat interval in milliseconds.
      example: { t: null, s: null, op: 10, d: { heartbeat_interval: 41250 } }
      schema:
        type: object
        required: [op, d]
        properties:
          op: { type: integer, const: 10 }
          d:
            type: object
            required: [heartbeat_interval]
            properties:
              heartbeat_interval: { type: number, description: Configured interval in milliseconds. }
  close:
    '4012': Missing or unsupported API version.
    '4002': Non-JSON encoding, a compress query parameter, or malformed Gateway JSON.
source:
  - https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L217-L221
  - https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L332-L344
  - https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/websocket.ts#L235
---

Opens a WebSocket connection to the local fake's Gateway at the root path. It uses the same protocol as [`GET /gateway`](get-gateway-upgrade.md), with no HTTP Authorization header. IDENTIFY and RESUME authenticate inside JSON frames.

## Request

Use uncompressed JSON text with masked client WebSocket frames. Do not send a `compress` query parameter, even `compress=false`.

## Response

Gateway query checks happen after the HTTP `101` upgrade. Invalid queries receive a close frame instead of HELLO; they are not HTTP `400` responses. A malformed WebSocket handshake returns HTTP `400` without a body.

After HELLO, follow the [identification and resume protocol](index.md#connect-and-identify).
