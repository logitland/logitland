---
title: 'ShowcaseLive.publish(frames)'
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

## ShowcaseLive.publish(frames)

| Object and method              | Input, return, and behavior                                                                                    | Binding example                                                                                             | Source                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ShowcaseLive.publish(frames)` | `ShowcaseFrame[]`; `Promise<void>`. Fans out serialized frames and filters stale deleted-message publications. | `await env.SHOWCASE_LIVE.get(env.SHOWCASE_LIVE.idFromName("home")).publish([{ type: "showcase.changed" }])` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L49) |
