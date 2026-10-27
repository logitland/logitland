---
title: 'setChannel({ key, channelId })'
description: Sets the staff alerts channel or the talk channel.
---

`key` is `alerts_channel_id` or `talk_channel_id`.
`channelId` is a snowflake or null. Null clears the setting.
PATCHes that settings field, refreshes `operations()`, and returns `undefined`.

```ts
await setChannel({ key: 'alerts_channel_id', channelId: null });
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L51>)
