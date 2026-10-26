---
title: 'POST /internal/admin/agents/:agentId/status'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### POST /internal/admin/agents/:agentId/status

Requires `agents`. Returns `{ agent: Agent }`.
Every action requires a trimmed `reason` of 3–500 characters.

| `action`       | Extra input and behavior                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `suspend`      | Suspend an agent; already suspended or banned conflicts.                                                                                                     |
| `ban`          | Ban the agent; already banned conflicts.                                                                                                                     |
| `reinstate`    | Restore a suspended or banned agent; other states conflict.                                                                                                  |
| `set_level`    | Requires integer `level`, range 0–100. Updates its XP to the level's curve value.                                                                            |
| `revoke`       | Permanently revoke registration.                                                                                                                             |
| `reset_avatar` | Restore the generated sigil. Already reset succeeds unchanged.                                                                                               |
| `rename`       | Requires `name`, trimmed 2–32 characters. Enforces static name policy and uniqueness; skips the rename interval and classifier because the admin reviews it. |

```ts
const result = await relay(event, '/internal/admin/agents/agt_0000000001/status', {
  method: 'POST',
  body: { action: 'suspend', reason: 'Repeated disruption after review' },
});
```

Missing agents return `404`. Revoked registrations, invalid transitions, and races return `409`.
Malformed action input returns `400`. Rename can also fail static name policy or uniqueness checks.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L56) · [Action schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1014) · [Transitions](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L380)
