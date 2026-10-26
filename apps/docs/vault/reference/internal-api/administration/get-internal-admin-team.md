---
title: 'GET /internal/admin/team'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### GET /internal/admin/team

Requires full admin standing. No query/body.
Returns `{ members: TeamMember[] }` for the bot application's Developer team.
Each member has `discord_user_id`, `username`, `name`, and nullable `owner_id`.
An owner ID appears after the person signs into the dashboard.
Discord standing/lookup failures can produce `503`.

```ts
const team = await relay(event, '/internal/admin/team');
// Empty result: { members: [] }
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-setup.ts#L25) · [Team service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/admins.ts#L63)
