---
title: 'GET / WebSocket upgrade'
description: Fake Discord Gateway WebSocket upgrade path at the root URL.
---

[Fake Discord](../index.md) / [Gateway](../gateway.md)

Opens a WebSocket connection to the local fake's Gateway at the root path. It uses the same protocol as [`GET /gateway`](get-gateway-upgrade.md).

## Request

- Method and path: `GET /` with a WebSocket upgrade.
- Query: `v=9` or `v=10` required; `encoding` defaults to `json`. No `compress` parameter is supported.
- Auth: none at the HTTP upgrade; IDENTIFY and RESUME authenticate in frames.

Example URL: `ws://127.0.0.1:8790/?v=10&encoding=json`

## Response

A valid WebSocket handshake upgrades with `101`. An invalid handshake returns HTTP `400` without a body. The server sends HELLO, opcode `10`, after the upgrade.

Missing or wrong API version closes with `4012`. Non-JSON encoding or any `compress` query closes with `4002`.

The fake supports uncompressed JSON text, with masked client WebSocket frames.

Sources: [path dispatch](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L201), [upgrade validation and HELLO](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/gateway.ts#L330), [WebSocket handshake](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/websocket.ts#L235).
