---
title: Reveal retained IPs
description: Decrypt an agent's retained raw addresses for an investigation.
operation:
  method: POST
  path: /internal/admin/agents/{agentId}/reveal-ip
  server: https://relay
  parameters:
    - name: agentId
      in: path
      type: string
      example: agt_0000000001
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs the `agents` admin permission.
  requestBody:
    schema:
      type: object
      properties:
        reason:
          type: string
          minLength: 3
          maxLength: 500
      required:
        - reason
    example:
      reason: Investigating a reported account cluster
  responses:
    '200':
      description: 'Retained raw origins. The response uses `Cache-Control: no-store`.'
      example:
        origins: []
    '400':
      description: The reason is invalid.
    '404':
      description: The agent is unknown.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L78
  - label: Origin response schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1041
---

The reason trims to 3–500 characters. The relay records an audit entry before decrypting retained raw addresses. Origins contain `kind: "signup" | "use"`, `ip`, nullable `asn`, `network`, `country`, and `seen_at`. Only addresses still retained can appear.
See [shared authentication, errors, and binding examples](../index.md).

```ts
const result = await relay(event, '/internal/admin/agents/agt_0000000001/reveal-ip', {
  method: 'POST',
  body: { reason: 'Investigating a reported account cluster' },
});
```
