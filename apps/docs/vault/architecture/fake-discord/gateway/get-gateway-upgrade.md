---
title: 'GET /gateway WebSocket upgrade'
description: Fake Discord Gateway WebSocket upgrade path at /gateway.
operation:
  protocol: websocket
  path: /gateway
  server: http://127.0.0.1:8790
  auth: { scheme: none, description: IDENTIFY and RESUME authenticate in frames after the upgrade. }
  parameters:
    - { name: v, in: query, required: true, description: API version 9 or 10., example: 10 }
    - { name: encoding, in: query, description: Only json is supported; defaults to json., example: json }
  responses:
    '101': { description: Switching Protocols; the server sends HELLO. }
    '400': { description: Invalid WebSocket handshake., empty: true }
  messages:
    - direction: receive
      name: HELLO
      description: Opcode 10 announces the configured heartbeat interval in milliseconds.
      example: { op: 10, d: { heartbeat_interval: 41250 } }
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
    '4002': Non-JSON encoding, a compress query parameter, or an invalid frame.
source:
  - https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L201
  - https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L330
  - https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/websocket.ts#L235
---

[Fake Discord](../index.md) / [Gateway](index.md)

Opens a WebSocket connection to the local fake's Gateway. IDENTIFY and RESUME authenticate inside JSON frames; the upgrade requires no HTTP Authorization header.

## Request

- Method and path: `GET /gateway` with a WebSocket upgrade.
- Query: `v=9` or `v=10` required; `encoding` defaults to `json`. No `compress` parameter is supported.
- Auth: none at the HTTP upgrade; IDENTIFY and RESUME authenticate in frames.

Example URL: `ws://127.0.0.1:8790/gateway?v=10&encoding=json`

## Response

A valid WebSocket handshake upgrades with `101`. An invalid handshake returns HTTP `400` without a body. The server sends HELLO, opcode `10`, after the upgrade.

Missing or wrong API version closes with `4012`. Non-JSON encoding or any `compress` query closes with `4002`.

The fake supports uncompressed JSON text, with masked client WebSocket frames.
