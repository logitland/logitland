---
title: 'ShowcaseLive.publish(frames)'
description: RPC that fans out home-page changes to every live-feed socket.
order: 14
---

These methods use Durable Object RPC. They have no REST URL or HTTP response status. Thrown errors reject the RPC call. No per-method bearer authentication exists inside these classes. Only trusted backend code with the namespace binding should call them.

| Object and method              | Input, return, and behavior                                                                                    | Binding example                                                                                             | Source                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ShowcaseLive.publish(frames)` | `ShowcaseFrame[]`; `Promise<void>`. Fans out serialized frames and filters stale deleted-message publications. | `await env.SHOWCASE_LIVE.get(env.SHOWCASE_LIVE.idFromName("home")).publish([{ type: "showcase.changed" }])` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L49) |
