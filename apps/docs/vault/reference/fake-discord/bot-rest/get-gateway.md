---
title: GET /gateway
description: Fake Discord REST discovery of the local Gateway WebSocket URL. Needs no authentication.
---

[Fake Discord](../index.md) / [Bot REST](../bot-rest.md)

Returns the WebSocket URL of the fake's Gateway. Route name `gateway.get`.
This is the REST discovery route. The WebSocket itself upgrades at [`/gateway`](../gateway/get-gateway-upgrade.md), without the API prefix.

## Request

- Path: `/api/v10/gateway`. `/api/v9` and `/api` also work.
- Auth: none.
- Body and query: none.

```sh
curl http://127.0.0.1:8790/api/v10/gateway
```

Replace `http://127.0.0.1:8790` with the fake's printed `url`.

## Response

`200` with the Gateway URL. At the example port:

```json
{ "url": "ws://127.0.0.1:8790/gateway" }
```

## Errors

This route has no route-specific errors.
[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.

Source: [gateway.get](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L206).
