---
title: 'setChannel({ key, channelId })'
---

See [admin remote-function overview](index.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### setChannel({ key, channelId })

`key` is `alerts_channel_id` or `talk_channel_id`.
`channelId` is a snowflake or null. Null clears the setting.
PATCHes that settings field, refreshes `operations()`, and returns `undefined`.

```ts
await setChannel({ key: 'alerts_channel_id', channelId: null });
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L51>)
