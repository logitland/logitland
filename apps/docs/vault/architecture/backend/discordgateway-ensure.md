---
title: 'DiscordGateway.ensure()'
description: RPC that checks the Discord Gateway connection and connects when needed, subject to configuration and retry delays.
order: 5
---

Private Durable Object RPC; see the [binding and authentication boundaries](index.md). Errors reject the call rather than returning an HTTP status.

| Object and method         | Input, return, and behavior                                                                                                                      | Binding example                                                     | Source                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DiscordGateway.ensure()` | No arguments; `Promise<void>`. Checks the connection and connects if needed. Object name is `discord`. Cron calls it; alarms provide a backstop. | `await env.GATEWAY.get(env.GATEWAY.idFromName("discord")).ensure()` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/gateway.ts#L43) |

The call resolves after a connection attempt, not after the session is ready. A missing bot token or a fatal-close retry delay can leave the Gateway stopped. Use [status()](discordgateway-status.md) to inspect the result.

[Connection checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/gateway/service.ts#L154)
