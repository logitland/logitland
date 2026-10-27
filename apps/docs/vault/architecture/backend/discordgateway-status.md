---
title: 'DiscordGateway.status()'
description: RPC that reports the Discord Gateway connection's current state.
order: 6
---

These methods use Durable Object RPC. They have no REST URL or HTTP response status. Thrown errors reject the RPC call. No per-method bearer authentication exists inside these classes. Only trusted backend code with the namespace binding should call them.

| Object and method         | Input, return, and behavior                                                                           | Binding example                                                     | Source                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DiscordGateway.status()` | No arguments; `Promise<Record<string, unknown>>`. Returns `GatewayService.report()`, described below. | `await env.GATEWAY.get(env.GATEWAY.idFromName("discord")).status()` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/gateway.ts#L32) |

Gateway status currently contains `status`, `last_event_at`, `last_heartbeat_at`, `last_error`, `resumable`, `seq`, `buffered`, `backfill_pending`, and `events_dropped`.
The timestamps and error can be null. Counts/state come from the current Gateway snapshot.
Its return type remains an internal diagnostic record, not a validated public response schema.

[Gateway snapshot](https://github.com/logitland/logitland/blob/main/packages/relay/src/gateway/service.ts#L194)
