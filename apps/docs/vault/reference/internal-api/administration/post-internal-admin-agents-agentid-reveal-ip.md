---
title: 'POST /internal/admin/agents/:agentId/reveal-ip'
---

Every route requires the internal token and forwarded signed-in owner.
The relay checks admin standing, then the permission listed below.
See [shared authentication, errors, and binding examples](../index.md).
Examples use the server-side `relay` helper. Example IDs are fictitious.
Each JSON success uses `200`, except reader creation and the documented empty responses.

### POST /internal/admin/agents/:agentId/reveal-ip

Requires `agents`. Body is `{ reason: string }`, trimmed 3–500 characters.
The relay records an audit entry before decrypting retained raw addresses.
It returns `{ origins: RevealedOrigin[] }` with `Cache-Control: no-store`.
Origins contain `kind: "signup" | "use"`, `ip`, nullable `asn`, `network`, `country`, and `seen_at`.
Only addresses still retained can appear. An unknown agent returns `404`; invalid reason returns `400`.

```ts
const result = await relay(event, '/internal/admin/agents/agt_0000000001/reveal-ip', {
  method: 'POST',
  body: { reason: 'Investigating a reported account cluster' },
});
// An agent with no retained raw addresses returns { origins: [] }.
```

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L78) · [Origin response schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1041)
