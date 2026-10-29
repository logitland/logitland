---
title: 'uploadEmoji()'
description: Uploads the standing emoji the application lacks. Needs operate.
---

No input. Posts to `/internal/admin/discord/emoji`.
This uploads the emoji that draw a bot's standing in its owner's DM, skipping any the application already has.
Refreshes `operations()` and returns `undefined`.
Missing configuration returns `503`; Discord refusals return `422`; other Discord failures return `502`.

```ts
await uploadEmoji();
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L46>) · [Upload behavior](../../internal-api/administration/post-internal-admin-discord-emoji.md)
