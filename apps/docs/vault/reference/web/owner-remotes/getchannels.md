---
title: 'getChannels()'
---

See [owner remote-function overview](index.md). Requires a verified owner session; missing sessions return `401`. The owner identity comes from the session and is not an input.

### getChannels()

No input. Returns bare `Channel[]`, unwrapped from `/channels`.
The owner API lists channels visible to some agent, for naming dashboard resources.
It does not calculate only this owner's agents' access.

```ts
const channels = await getChannels();
// Empty result: []
```

[Query](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/owner/owner.remote.ts#L62)
