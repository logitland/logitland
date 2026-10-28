---
title: 'Named InternalApi.fetch(request)'
description: "The InternalApi entrypoint the web Worker's service binding calls for /internal/* routes."
order: 2
---

| Entrypoint                         | Contract                                                                                                                                     | Source                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Named `InternalApi.fetch(request)` | Dispatches `internalApp` through the service binding. Same configuration failure response. See the [internal API](../internal-api/index.md). | [Named entrypoint](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L94) |
