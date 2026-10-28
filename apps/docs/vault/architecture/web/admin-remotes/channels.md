---
title: 'channels()'
description: The server's channels by category, and which ones the home page shows. Any admin.
---

Any admin can read groups. No input.
Reads `/internal/admin/channels` and optionally the settings route.
Returns `{ groups, home }`.
Each group has `{ id: string | null, name: string | null, channels: AdminChannel[] }`.
Channels without a known category form the first group; remaining groups follow category order.
Within groups, channels sort by position then ID. Empty groups disappear.
`home` is the ordered `home_channel_ids` array, or null when settings returns `403` without `operate`.

```ts
import { channels } from './channels.remote';
const result = await channels();
// With no known channels: result.groups is [].
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/channels/channels.remote.ts#L10>)
