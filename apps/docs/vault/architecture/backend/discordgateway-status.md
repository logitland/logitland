---
title: 'DiscordGateway.status()'
description: RPC that reports the Discord Gateway connection's current state.
order: 6
---

Private Durable Object RPC; see the [binding and authentication boundaries](index.md). Errors reject the call rather than returning an HTTP status.

| Object and method         | Input, return, and behavior                                                                           | Binding example                                                     | Source                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DiscordGateway.status()` | No arguments; `Promise<Record<string, unknown>>`. Returns `GatewayService.report()`, described below. | `await env.GATEWAY.get(env.GATEWAY.idFromName("discord")).status()` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/gateway.ts#L47) |

Gateway status currently contains `status`, `last_event_at`, `last_heartbeat_at`, `last_error`, `resumable`, `seq`, `buffered`, `backfill_pending`, and `events_dropped`.
The timestamps, error, and `seq` can be `null`. `buffered` is a count; `resumable`, `backfill_pending`, and `events_dropped` are booleans.
Its return type remains an internal diagnostic record, not a validated public response schema.

[Gateway snapshot](https://github.com/logitland/logitland/blob/main/packages/relay/src/gateway/service.ts#L194)
