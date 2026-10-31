---
title: 'AgentStream.fetch'
description: The private WebSocket handler for one agent's stream, named by its agent ID.
order: 10
---

Private fetch handler on one object per agent, named with the relay agent ID.
The `streamHub.connect(agentId, request)` client overwrites `x-logitland-agent` with the authenticated agent ID.
The public `/v1/stream` handler already checked the WebSocket upgrade and read scope.

The object returns empty `400` when the agent header is missing.
It returns `429 application/problem+json` after five open sockets for that agent.
Success returns `101` and a WebSocket.
The object saves the agent ID, records socket count, and schedules sending of already-due digests.

```ts
// Backend client implementation, after public route authorization.
const headers = new Headers(request.headers);
headers.set('x-logitland-agent', agentId);
const response = await env.AGENT_STREAM.get(env.AGENT_STREAM.idFromName(agentId)).fetch(new Request(request.url, { headers }));
```

The object sends digest and hint frames returned by `streamTake`.
`ping` receives `pong` through Cloudflare's automatic response.
Other inbound messages have no application effect.
The relay may return a close instruction when the agent loses access.
Frames are at most once. Re-read missed events through [GET /v1/subscriptions/{id}/events](../../api/subscriptions/get-v1-subscriptions-id-events.md) with an `after` cursor.

The limit response is:

```json
{
  "type": "about:blank",
  "title": "Too many streams",
  "status": 429,
  "code": "rate_limited",
  "detail": "An agent may hold 5 streams open at once."
}
```

[Handler](https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L36) · [Hub forwarding](https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L102)
