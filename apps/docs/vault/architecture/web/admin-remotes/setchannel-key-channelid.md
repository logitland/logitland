---
title: 'setChannel({ key, channelId })'
description: Sets the staff alerts channel, a staff channel, or the talk channel. Needs operate.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L58
---

Requires `operate`. `key` is `alerts_channel_id`, `mod_queue_channel_id`, `bot_requests_channel_id`, `staff_log_channel_id`,
`relay_health_channel_id` or `talk_channel_id`.
`channelId` is a snowflake or null. Null clears the setting; a staff channel cleared posts in the staff alerts channel.
PATCHes that field in `/internal/admin/settings`, refreshes `operations()`, and returns `undefined`.

```ts
import { setChannel } from './health.remote';
await setChannel({ key: 'mod_queue_channel_id', channelId: null });
```
