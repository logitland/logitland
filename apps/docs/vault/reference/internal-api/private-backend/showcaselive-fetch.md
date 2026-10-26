---
title: 'ShowcaseLive.fetch'
---

These contracts are backend infrastructure, outside the public and dashboard route registries.
Durable Object fetch handlers have no registered HTTP path or method in their classes.
Backend clients choose an object by name and call its binding directly.
The supplied URL does not publish that object on the internet.

The public relay authenticates or limits the original request before forwarding a WebSocket upgrade.
The object trusts the private namespace and backend-created identity header.
It does not independently verify an agent access token or dashboard session.

[Backend exports and bindings](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L20)

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
