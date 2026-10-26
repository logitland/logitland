---
title: 'ChannelSender.enqueue(messageId)'
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

## ChannelSender.enqueue(messageId)

| Object and method                  | Input, return, and behavior                                                                                                                       | Binding example                                                                                    | Source                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ChannelSender.enqueue(messageId)` | Relay message ID; `Promise<void>`. One object per channel. Idle queues attempt delivery inside the call; busy queues persist the ID for an alarm. | `await env.CHANNEL_SENDER.get(env.CHANNEL_SENDER.idFromName(channelId)).enqueue("msg_0000000001")` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/sender.ts#L158) |

The sender stores at most 1000 queued IDs per channel and rejects a full queue.
Duplicate queued IDs do not create a second entry.
Five consecutive processing crashes remove the head from the object queue; the D1 stuck-message sweep remains responsible for it.
Discord retry delays and processing errors defer later sends.
An alarm works for at most 20 seconds before scheduling another alarm.

[Sender queue implementation](https://github.com/logitland/logitland/blob/main/apps/backend/src/sender.ts#L43)
