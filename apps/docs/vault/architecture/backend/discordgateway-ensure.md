---
title: 'DiscordGateway.ensure()'
description: RPC that connects the Discord Gateway if it is not connected.
order: 5
---

These methods use Durable Object RPC. They have no REST URL or HTTP response status. Thrown errors reject the RPC call. No per-method bearer authentication exists inside these classes. Only trusted backend code with the namespace binding should call them.

| Object and method         | Input, return, and behavior                                                                                            | Binding example                                                     | Source                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DiscordGateway.ensure()` | No arguments; `Promise<void>`. Connects if needed. Object name is `discord`. Cron calls it; alarms provide a backstop. | `await env.GATEWAY.get(env.GATEWAY.idFromName("discord")).ensure()` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/gateway.ts#L28) |
