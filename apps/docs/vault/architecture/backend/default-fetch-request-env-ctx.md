---
title: 'Default fetch(request, env, ctx)'
description: The backend's public fetch handler. Serves only the public relay routes.
order: 1
---

| Entrypoint                         | Contract                                                                                                                                                | Source                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Default `fetch(request, env, ctx)` | Dispatches only `relayApp`, the public registry. Configuration failures return `503 application/problem+json`. Other unexpected setup errors propagate. | [Worker handler](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L73) |
