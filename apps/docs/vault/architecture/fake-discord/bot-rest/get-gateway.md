---
title: Get the Gateway URL
description: Return the fake Gateway's WebSocket URL.
operation:
  method: GET
  path: /api/v10/gateway
  server: http://127.0.0.1:8790
  auth: none
  responses:
    '200':
      description: The Gateway WebSocket URL.
      example:
        url: ws://127.0.0.1:8790/gateway
source:
  - label: gateway.get
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L303
---

Returns the WebSocket URL of the fake's Gateway. Route name `gateway.get`.
This is the REST discovery route. The WebSocket itself upgrades at [`/gateway`](../gateway/get-gateway-upgrade.md), without the API prefix.

The `/api/v9` and `/api` prefixes also work.
[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
