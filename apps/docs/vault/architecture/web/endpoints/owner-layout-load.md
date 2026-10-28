---
title: 'Owner layout'
description: The load every owner dashboard page shares. Sends signed-out people to sign in.
---

Requires a session. Otherwise `303` to `/sign-in?next=<pathname>`. Returns `{ person, standing }`; standing is read from the relay on each navigation. `person` contains ID, display name/handle from username, and optional avatar. Example `GET /agents`.

[Layout](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/(owner)/+layout.server.ts#L4>) · [Shared load](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/dashboard.ts#L10)

[Shared load](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/dashboard.ts#L10)
