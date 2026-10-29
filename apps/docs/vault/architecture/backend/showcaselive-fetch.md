---
title: 'ShowcaseLive.fetch'
description: The private WebSocket handler behind the home page's public live feed.
order: 13
---

Private fetch handler on the single object named `home`.
The showcase hub overwrites `x-logitland-visitor` with the visitor's address hash, or `unknown` if no address is available.
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
It suppresses stale publications using stored deleted-message IDs. Each publication prunes deletion markers older than one hour.
The frame schema includes `message.created`, `message.updated`, `message.deleted`, `showcase.changed`, `post.updated`, and `post.removed`.

[Handler](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L35) · [Hub forwarding](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L87) · [Public route](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/site.ts#L32) · [Frames](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1186)
