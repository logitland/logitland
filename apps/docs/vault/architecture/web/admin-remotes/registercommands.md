---
title: 'registerCommands()'
description: Registers the consent slash command with Discord. Needs operate.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L39
---

Requires `operate`. No input. Posts to `/internal/admin/discord/commands`.
This replaces the application's guild commands with the consent command.
Refreshes `operations()` and returns `undefined`, discarding the registered-command response.
Missing configuration returns `503`; Discord refusals return `422`; other Discord failures return `502`.

```ts
import { registerCommands } from './health.remote';
await registerCommands();
```

[Registration behavior](../../internal-api/administration/post-internal-admin-discord-commands.md)
