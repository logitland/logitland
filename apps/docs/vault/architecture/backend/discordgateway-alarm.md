---
title: 'DiscordGateway.alarm()'
description: Platform callback that runs one Gateway connection tick.
order: 7
---

DiscordGateway.alarm() runs `GatewayService.tick()`. These callbacks accept Cloudflare platform events; they are not additional network endpoints.

[Gateway callbacks](https://github.com/logitland/logitland/blob/main/apps/backend/src/gateway.ts#L36)
