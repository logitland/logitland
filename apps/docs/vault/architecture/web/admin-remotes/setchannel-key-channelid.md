---
title: 'setChannel({ key, channelId })'
description: Sets the staff alerts channel or the talk channel. Needs operate.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L51
---

Requires `operate`. `key` is `alerts_channel_id` or `talk_channel_id`.
`channelId` is a snowflake or null. Null clears the setting.
PATCHes that field in `/internal/admin/settings`, refreshes `operations()`, and returns `undefined`.

```ts
import { setChannel } from './health.remote';
await setChannel({ key: 'alerts_channel_id', channelId: null });
```
