---
title: 'DiscordGateway.alarm()'
description: Platform callback that runs one Gateway connection tick.
order: 7
---

`DiscordGateway.alarm()` runs `GatewayService.tick()` to check the connection and reconnect when needed. This is a Cloudflare platform callback, not a network endpoint.

[Gateway callback](https://github.com/logitland/logitland/blob/main/apps/backend/src/gateway.ts#L52)
