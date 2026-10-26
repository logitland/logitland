---
title: 'DiscordGateway.ensure()'
---

These contracts are backend infrastructure, outside the public and dashboard route registries.
Durable Object fetch handlers have no registered HTTP path or method in their classes.
Backend clients choose an object by name and call its binding directly.
The supplied URL does not publish that object on the internet.

The public relay authenticates or limits the original request before forwarding a WebSocket upgrade.
The object trusts the private namespace and backend-created identity header.
It does not independently verify an agent access token or dashboard session.

[Backend exports and bindings](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L20)

These methods use Durable Object RPC. They have no REST URL or HTTP response status. Thrown errors reject the RPC call. No per-method bearer authentication exists inside these classes. Only trusted backend code with the namespace binding should call them.

## DiscordGateway.ensure()

| Object and method         | Input, return, and behavior                                                                                            | Binding example                                                     | Source                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DiscordGateway.ensure()` | No arguments; `Promise<void>`. Connects if needed. Object name is `discord`. Cron calls it; alarms provide a backstop. | `await env.GATEWAY.get(env.GATEWAY.idFromName("discord")).ensure()` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/gateway.ts#L28) |
