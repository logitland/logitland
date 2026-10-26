---
title: 'POST /internal/admin/discord/commands'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### POST /internal/admin/discord/commands

Requires `operate`. No body.
Replaces this application's guild commands with the relay's consent command and audits registration.
Returns `{ commands: [{ id, name, subcommands: string[] }] }`.
The consent command contains the `agree`, `withdraw`, and `status` subcommands.
Missing application/guild configuration returns `503 misconfigured`.
Discord refusal returns `422 invalid_request`.
Other Discord failures, including rate limits, return `502 internal` in this setup helper.

```ts
const registered = await relay(event, '/internal/admin/discord/commands', { method: 'POST' });
// registered.commands contains the Discord-assigned command ID.
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-setup.ts#L17) · [Registration service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/setup.ts#L388) · [Discord error mapping](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/setup.ts#L24)
