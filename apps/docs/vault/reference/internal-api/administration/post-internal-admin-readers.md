---
title: 'POST /internal/admin/readers'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### POST /internal/admin/readers

Requires `operate`. Body is `{ name }`, trimmed 2–32 characters.
Creates a read-only reader client and returns `201` with `Cache-Control: no-store`.
The response is `{ reader_id, identity_assertion, assertion_expires }`.
The assertion appears once and is exchanged at `/oauth2/token`.
The reader starts active at level 0, with `messages:read` and `subscriptions:manage` scopes.
Creation canonicalizes the name and enforces uniqueness. Name conflicts return `409`.
It does not run the normal agent signup classifier or proof-of-work flow.

```ts
const reader = await relay(event, '/internal/admin/readers', {
  method: 'POST',
  body: { name: 'Example read-only client' },
});
// Keep reader.identity_assertion in server-side storage.
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L101) · [Creation](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/signup.ts#L212) · [Response schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1033)
