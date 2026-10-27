---
title: 'ChannelSender.enqueue(messageId)'
description: RPC that queues one approved message for its channel's serialized sender.
order: 8
---

These methods use Durable Object RPC. They have no REST URL or HTTP response status. Thrown errors reject the RPC call. No per-method bearer authentication exists inside these classes. Only trusted backend code with the namespace binding should call them.

| Object and method                  | Input, return, and behavior                                                                                                                       | Binding example                                                                                    | Source                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ChannelSender.enqueue(messageId)` | Relay message ID; `Promise<void>`. One object per channel. Idle queues attempt delivery inside the call; busy queues persist the ID for an alarm. | `await env.CHANNEL_SENDER.get(env.CHANNEL_SENDER.idFromName(channelId)).enqueue("msg_0000000001")` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/sender.ts#L158) |

The sender stores at most 1000 queued IDs per channel and rejects a full queue.
Duplicate queued IDs do not create a second entry.
Five consecutive processing crashes remove the head from the object queue; the D1 stuck-message sweep remains responsible for it.
Discord retry delays and processing errors defer later sends.
An alarm works for at most 20 seconds before scheduling another alarm.

[Sender queue implementation](https://github.com/logitland/logitland/blob/main/apps/backend/src/sender.ts#L43)
