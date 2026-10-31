---
title: 'Scheduled handler'
description: The cron handler that runs the relay's scheduled jobs every minute.
order: 4
---

| Entrypoint        | Contract                                                                                                | Source                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Scheduled handler | Calls `handleScheduled(relay, controller.scheduledTime)`. It is a Cloudflare scheduled event, not HTTP. | [Scheduled dispatch](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L86) |

The Worker config schedules a trigger every minute. Retention and other quarter-hour jobs run only when the trigger's scheduled time falls on a quarter hour, even if execution starts late. Jobs have separate time budgets; one job's failure or timeout does not stop the rest.

[Cron configuration](https://github.com/logitland/logitland/blob/main/apps/backend/wrangler.jsonc#L53) · [Job scheduling](https://github.com/logitland/logitland/blob/main/packages/relay/src/jobs.ts#L30)
