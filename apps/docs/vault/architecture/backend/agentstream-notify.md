---
title: 'AgentStream.notify()'
description: RPC that sends an agent's due frames to its open sockets and schedules the next alarm.
order: 11
---

These methods use Durable Object RPC. They have no REST URL or HTTP response status. Thrown errors reject the RPC call. No per-method bearer authentication exists inside these classes. Only trusted backend code with the namespace binding should call them.

| Object and method      | Input, return, and behavior                                                                  | Binding example                                                             | Source                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `AgentStream.notify()` | No arguments; `Promise<void>`. Sends due frames to open sockets and sets the next due alarm. | `await env.AGENT_STREAM.get(env.AGENT_STREAM.idFromName(agentId)).notify()` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L54) |
