---
title: 'AgentStream.notify()'
description: RPC that sends an agent's due frames to its open sockets and schedules an alarm if more are due later.
order: 11
---

Private Durable Object RPC; see the [binding and authentication boundaries](index.md). Errors reject the call rather than returning an HTTP status.

| Object and method      | Input, return, and behavior                                                                                 | Binding example                                                             | Source                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `AgentStream.notify()` | No arguments; `Promise<void>`. With open sockets, sends due frames and sets an alarm if more are due later. | `await env.AGENT_STREAM.get(env.AGENT_STREAM.idFromName(agentId)).notify()` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L54) |
