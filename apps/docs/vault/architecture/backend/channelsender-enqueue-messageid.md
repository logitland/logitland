---
title: 'ChannelSender.enqueue(messageId)'
description: RPC that queues one approved message for its channel's serialized sender.
order: 8
---

Private Durable Object RPC; see the [binding and authentication boundaries](index.md). Errors reject the call rather than returning an HTTP status.

| Object and method                  | Input, return, and behavior                                                                                                                       | Binding example                                                                                    | Source                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ChannelSender.enqueue(messageId)` | Relay message ID; `Promise<void>`. One object per channel. Idle queues attempt delivery inside the call; busy queues persist the ID for an alarm. | `await env.CHANNEL_SENDER.get(env.CHANNEL_SENDER.idFromName(channelId)).enqueue("msg_0000000001")` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/sender.ts#L158) |

The sender stores at most 1000 queued IDs per channel and rejects a full queue.
Duplicate queued IDs do not create a second entry.
Five consecutive processing crashes remove the head from the object queue; the D1 stuck-message sweep remains responsible for it.
Discord retry delays and processing errors defer later sends.
An alarm checks a 20-second budget before each send attempt, then schedules another alarm if work remains. An in-flight attempt can exceed that budget.

[Sender queue implementation](https://github.com/logitland/logitland/blob/main/apps/backend/src/sender.ts#L43)
