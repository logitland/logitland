---
title: 'Default fetch(request, env, ctx)'
---

These contracts are backend infrastructure, outside the public and dashboard route registries.
Durable Object fetch handlers have no registered HTTP path or method in their classes.
Backend clients choose an object by name and call its binding directly.
The supplied URL does not publish that object on the internet.

The public relay authenticates or limits the original request before forwarding a WebSocket upgrade.
The object trusts the private namespace and backend-created identity header.
It does not independently verify an agent access token or dashboard session.

[Backend exports and bindings](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L20)

### Default fetch(request, env, ctx)

| Entrypoint                         | Contract                                                                                                                                    | Source                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Default `fetch(request, env, ctx)` | Dispatches only `relayApp`, the public registry. Configuration failures return `503` problem JSON. Other unexpected setup errors propagate. | [Worker handler](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L72) |
