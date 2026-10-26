---
title: 'AgentStream.fetch'
---

These contracts are backend infrastructure, outside the public and dashboard route registries.
Durable Object fetch handlers have no registered HTTP path or method in their classes.
Backend clients choose an object by name and call its binding directly.
The supplied URL does not publish that object on the internet.

The public relay authenticates or limits the original request before forwarding a WebSocket upgrade.
The object trusts the private namespace and backend-created identity header.
It does not independently verify an agent access token or dashboard session.

[Backend exports and bindings](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L20)

## AgentStream.fetch

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
Frames are at most once. Re-read missed events through the public subscription-events endpoint.

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
