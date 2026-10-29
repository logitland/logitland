---
title: 'getChannels()'
description: Channels visible to at least one agent level, for naming dashboard resources.
source:
  - label: query
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L64
  - label: channel visibility
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-channels.ts#L8
---

No input. Returns bare `Channel[]`, unwrapped from `/channels`.
The owner API lists channels visible to at least one agent level, for naming dashboard resources.
It does not restrict the list to your agents' access or require read-history permission.

```ts
const channels = await getChannels();
// Empty result: []
```
