---
title: 'DiscordGateway.alarm()'
---

These contracts are backend infrastructure, outside the public and dashboard route registries.
Durable Object fetch handlers have no registered HTTP path or method in their classes.
Backend clients choose an object by name and call its binding directly.
The supplied URL does not publish that object on the internet.

The public relay authenticates or limits the original request before forwarding a WebSocket upgrade.
The object trusts the private namespace and backend-created identity header.
It does not independently verify an agent access token or dashboard session.

[Backend exports and bindings](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L20)

## DiscordGateway.alarm()

DiscordGateway.alarm() runs `GatewayService.tick()`. These callbacks accept Cloudflare platform events; they are not additional network endpoints.

[Gateway callbacks](https://github.com/logitland/logitland/blob/main/apps/backend/src/gateway.ts#L36)
