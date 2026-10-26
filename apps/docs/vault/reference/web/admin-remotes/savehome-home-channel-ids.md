---
title: 'saveHome(home_channel_ids)'
---

See [admin remote-function overview](../admin-remotes.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### saveHome(home_channel_ids)

Requires `operate`. Input is an array of at most ten Discord snowflakes.
PATCHes settings with `{ home_channel_ids }`, refreshes `channels()`, and returns `undefined`.
An empty array removes all live home channels.
The relay returns `422` for channels not readable by every agent.

```ts
import { saveHome } from './channels.remote';
await saveHome(['123456789012345678']);
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/channels/channels.remote.ts#L26>)
