---
title: 'Scheduled handler'
description: The cron handler that runs the relay's scheduled jobs every minute.
order: 4
---

| Entrypoint        | Contract                                                                                                | Source                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Scheduled handler | Calls `handleScheduled(relay, controller.scheduledTime)`. It is a Cloudflare scheduled event, not HTTP. | [Scheduled dispatch](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L85) |
