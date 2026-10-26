---
title: 'GET /internal/admin/setup'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

These routes register through `internal-admin-channels.ts`, which calls `internal-admin-setup.register`.
They belong to the internal app even though setup is absent from the top-level module list.

### GET /internal/admin/setup

Requires `operate`. No query/body.
Returns `{ checks: SetupCheck[] }`.
Each check has `id`, `title`, `status`, `detail`, and `fix`.
Status is `ok`, `warn`, `fail`, or `unknown`.
The checks cover bot token, guild, message-content intent, interaction URL, consent command, agent roles, agent channels, Gateway, and classifier.
Each check catches its own failure. Unexpected and Discord lookup errors become `unknown`.
Expected configuration failures can return `fail`; one failed check does not discard the rest.
The admin guard can still fail before checks start.

```ts
const report = await relay(event, '/internal/admin/setup');
const command = report.checks.find((check) => check.id === 'consent-command');
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-setup.ts#L15) · [Checklist](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/setup.ts#L370) · [Check schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L897)
