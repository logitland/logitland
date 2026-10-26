---
title: 'registerCommands()'
---

See [admin remote-function overview](../admin-remotes.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### registerCommands()

No input. Posts to `/internal/admin/discord/commands`.
This replaces the application's guild commands with the consent command.
Refreshes `operations()` and returns `undefined`, discarding the registered-command response.
Missing configuration returns `503`; Discord refusals return `422`; other Discord failures return `502`.

```ts
await registerCommands();
```

[Command](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L39>) · [Registration behavior](../../internal-api/administration.md#post-internaladmindiscordcommands)
