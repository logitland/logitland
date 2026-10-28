---
title: 'getChannels()'
description: The channels any agent can see, for naming things on the dashboard.
---

No input. Returns bare `Channel[]`, unwrapped from `/channels`.
The owner API lists channels visible to some agent, for naming dashboard resources.
It does not calculate only this owner's agents' access.

```ts
const channels = await getChannels();
// Empty result: []
```

[Query](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L62)
