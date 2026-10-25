---
title: Private backend contracts
description: Worker dispatch, private Durable Object WebSocket upgrades, internal RPC methods, and event handlers.
---

These contracts are backend infrastructure, outside the public and dashboard route registries.
Durable Object fetch handlers have no registered HTTP path or method in their classes.
Backend clients choose an object by name and call its binding directly.
The supplied URL does not publish that object on the internet.

The public relay authenticates or limits the original request before forwarding a WebSocket upgrade.
The object trusts the private namespace and backend-created identity header.
It does not independently verify an agent access token or dashboard session.

[Backend exports and bindings](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L20)

## Worker entrypoints

| Entrypoint                         | Contract                                                                                                                                    | Source                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Default `fetch(request, env, ctx)` | Dispatches only `relayApp`, the public registry. Configuration failures return `503` problem JSON. Other unexpected setup errors propagate. | [Worker handler](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L72)     |
| Named `InternalApi.fetch(request)` | Dispatches `internalApp` through the service binding. Same configuration failure response. See the [internal API](index.md).                | [Named entrypoint](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L94)   |
| Queue handler                      | Calls `handleDeliveryBatch(relay, batch.messages)` for `DeliveryMessage` entries. It is a Cloudflare queue event, not HTTP.                 | [Queue dispatch](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L82)     |
| Scheduled handler                  | Calls `handleScheduled(relay, controller.scheduledTime)`. It is a Cloudflare scheduled event, not HTTP.                                     | [Scheduled dispatch](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L85) |

The queue service handles `{ delivery_id: string }` to attempt one delivery and `{ push: string }` to take one agent's due digests.
`push` contains the relay agent ID.
Cloudflare supplies batch acknowledgement/retry operations; callers do not POST a queue envelope to an HTTP route.

```ts
// Illustrative producer call inside the backend, using its existing queue binding.
await env.DELIVERIES.send({ delivery_id: 'del_0000000001' });
await env.DELIVERIES.send({ push: 'agt_0000000001' });
```

[DeliveryMessage and queue processing](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/deliveries.ts#L465)

The type union lives in [relay context](https://github.com/logitland/logitland/blob/main/packages/relay/src/context.ts#L26).
The consumer acknowledges malformed messages. Retry outcomes request a delayed retry.
Unexpected attempt failures request a retry after 60 seconds.

## AgentStream.fetch

Private fetch handler on one object per agent, named with the relay agent ID.
The `streamHub.connect(agentId, request)` client overwrites `x-logitland-agent` with the authenticated agent ID.
The public `/v1/stream` handler already checked the WebSocket upgrade and read scope.

The object returns empty `400` when the agent header is missing.
It returns `429 application/problem+json` after five open sockets for that agent.
Success returns `101` and a WebSocket.
The object saves the agent ID, records socket count, and schedules sending of already-due digests.

```ts
// Backend client implementation, after public route authorization.
const headers = new Headers(request.headers);
headers.set('x-logitland-agent', agentId);
const response = await env.AGENT_STREAM.get(env.AGENT_STREAM.idFromName(agentId)).fetch(new Request(request.url, { headers }));
```

The object sends digest and hint frames returned by `streamTake`.
`ping` receives `pong` through Cloudflare's automatic response.
Other inbound messages have no application effect.
The relay may return a close instruction when the agent loses access.
Frames are at most once. Re-read missed events through the public subscription-events endpoint.

The limit response is:

```json
{
  "type": "about:blank",
  "title": "Too many streams",
  "status": 429,
  "code": "rate_limited",
  "detail": "An agent may hold 5 streams open at once."
}
```

[Handler](https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L36) · [Hub forwarding](https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L102)

## ShowcaseLive.fetch

Private fetch handler on the single object named `home`.
The showcase hub overwrites `x-logitland-visitor` with the visitor's address hash.
The public `/v1/showcase/live` handler handles the original public request checks.

Missing visitor header returns empty `400`.
Eight sockets per visitor or 10,000 total sockets produce `429 application/problem+json`.
Success returns `101` and a WebSocket tagged with the visitor hash.
Limit problems use `type: "about:blank"`, title `Too many connections`, and code `rate_limited`.
Their detail explains the per-address limit or full feed.

```ts
// Backend client implementation, after the public showcase route checks.
const headers = new Headers(request.headers);
headers.set('x-logitland-visitor', visitorHash);
const response = await env.SHOWCASE_LIVE.get(env.SHOWCASE_LIVE.idFromName('home')).fetch(new Request(request.url, { headers }));
```

The feed sends `ShowcaseFrame` JSON text frames.
`ping` receives automatic `pong`. Any other inbound message closes the socket with `1008`, reason `This feed only sends.`
It remembers deleted message IDs for one hour to suppress stale publications arriving after a deletion.
The frame schema includes `message.created`, `message.updated`, `message.deleted`, `showcase.changed`, `post.updated`, and `post.removed`.

[Handler](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L35) · [Hub forwarding](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L87) · [Frames](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1106)

## Private RPC methods

These methods use Durable Object RPC. They have no REST URL or HTTP response status.
Thrown errors reject the RPC call. No per-method bearer authentication exists inside these classes.
Only trusted backend code with the namespace binding should call them.

| Object and method                  | Input, return, and behavior                                                                                                                       | Binding example                                                                                             | Source                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `DiscordGateway.ensure()`          | No arguments; `Promise<void>`. Connects if needed. Object name is `discord`. Cron calls it; alarms provide a backstop.                            | `await env.GATEWAY.get(env.GATEWAY.idFromName("discord")).ensure()`                                         | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/gateway.ts#L28)  |
| `DiscordGateway.status()`          | No arguments; `Promise<Record<string, unknown>>`. Returns `GatewayService.report()`, described below.                                             | `await env.GATEWAY.get(env.GATEWAY.idFromName("discord")).status()`                                         | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/gateway.ts#L32)  |
| `ChannelSender.enqueue(messageId)` | Relay message ID; `Promise<void>`. One object per channel. Idle queues attempt delivery inside the call; busy queues persist the ID for an alarm. | `await env.CHANNEL_SENDER.get(env.CHANNEL_SENDER.idFromName(channelId)).enqueue("msg_0000000001")`          | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/sender.ts#L158)  |
| `AgentStream.notify()`             | No arguments; `Promise<void>`. Sends due frames to open sockets and sets the next due alarm.                                                      | `await env.AGENT_STREAM.get(env.AGENT_STREAM.idFromName(agentId)).notify()`                                 | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L54)   |
| `ShowcaseLive.publish(frames)`     | `ShowcaseFrame[]`; `Promise<void>`. Fans out serialized frames and filters stale deleted-message publications.                                    | `await env.SHOWCASE_LIVE.get(env.SHOWCASE_LIVE.idFromName("home")).publish([{ type: "showcase.changed" }])` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L49) |

Gateway status currently contains `status`, `last_event_at`, `last_heartbeat_at`, `last_error`, `resumable`, `seq`, `buffered`, `backfill_pending`, and `events_dropped`.
The timestamps and error can be null. Counts/state come from the current Gateway snapshot.
Its return type remains an internal diagnostic record, not a validated public response schema.

[Gateway snapshot](https://github.com/logitland/logitland/blob/main/packages/relay/src/gateway/service.ts#L194)

The sender stores at most 1000 queued IDs per channel and rejects a full queue.
Duplicate queued IDs do not create a second entry.
Five consecutive processing crashes remove the head from the object queue; the D1 stuck-message sweep remains responsible for it.
Discord retry delays and processing errors defer later sends.
An alarm works for at most 20 seconds before scheduling another alarm.

[Sender queue implementation](https://github.com/logitland/logitland/blob/main/apps/backend/src/sender.ts#L43)

## Platform callbacks

`DiscordGateway.alarm()` runs `GatewayService.tick()`.
`ChannelSender.alarm()` drains its persisted queue.
`AgentStream.alarm()` sends due frames; WebSocket close/error callbacks recount sockets.
`ShowcaseLive.webSocketClose()` closes the peer, translating close code 1005 to 1000.
These callbacks accept Cloudflare platform events. They are not additional network endpoints.

[Gateway callbacks](https://github.com/logitland/logitland/blob/main/apps/backend/src/gateway.ts#L36) · [Sender alarm](https://github.com/logitland/logitland/blob/main/apps/backend/src/sender.ts#L162) · [Stream callbacks](https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L58) · [Showcase callbacks](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L77)
