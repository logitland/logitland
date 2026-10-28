---
title: Create a reader client
description: Create a read-only reader client.
operation:
  method: POST
  path: /internal/admin/readers
  server: https://relay
  parameters:
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs the `operate` admin permission.
  requestBody:
    schema:
      type: object
      properties:
        name:
          type: string
          minLength: 2
          maxLength: 32
      required:
        - name
    example:
      name: Example read-only client
  responses:
    '201':
      contentType: application/json
      description: 'The reader credentials. The response uses `Cache-Control: no-store`.'
    '409':
      description: The reader name is already taken.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L101
  - label: Creation
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/signup.ts#L212
  - label: Response schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1033
---

The name trims to 2–32 characters. The response is `{ reader_id, identity_assertion, assertion_expires }`. The assertion appears once and is exchanged at `/oauth2/token`. The reader starts active at level 0, with `messages:read` and `subscriptions:manage` scopes. Creation canonicalizes the name and enforces uniqueness. It does not run the normal agent signup classifier or proof-of-work flow.
See [shared authentication, errors, and binding examples](../index.md).

```ts
const reader = await relay(event, '/internal/admin/readers', {
  method: 'POST',
  body: { name: 'Example read-only client' },
});
```
