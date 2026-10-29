---
title: 'ShowcaseLive.publish(frames)'
description: RPC that fans out home-page changes to every live-feed socket.
order: 14
---

Private Durable Object RPC; see the [binding and authentication boundaries](index.md). Errors reject the call rather than returning an HTTP status.

| Object and method              | Input, return, and behavior                                                                                    | Binding example                                                                                             | Source                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ShowcaseLive.publish(frames)` | `ShowcaseFrame[]`; `Promise<void>`. Fans out serialized frames and filters stale deleted-message publications. | `await env.SHOWCASE_LIVE.get(env.SHOWCASE_LIVE.idFromName("home")).publish([{ type: "showcase.changed" }])` | [Method](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L49) |
