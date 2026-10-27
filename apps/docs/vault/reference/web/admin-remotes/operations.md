---
title: 'operations()'
---

See [admin remote-function overview](index.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### operations()

No input. Reads setup checks, settings, admin channels, and server roles.
Returns `{ commands, channelIds, channels, roleIds, roles }`.
`commands` is the check whose ID is `consent-command`, or null.
`channelIds` maps `alerts_channel_id` and `talk_channel_id` to their configured ID or null.
`channels` contains nonhidden `{ id, name }` options.
`roleIds` maps `agents_role_id`, `parents_role_id`, and `consent_role_id` to ID or null.
`roles` contains `{ id, name }` options for server roles.

```ts
const options = await operations();
console.log(options.commands?.status);
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L15>)
