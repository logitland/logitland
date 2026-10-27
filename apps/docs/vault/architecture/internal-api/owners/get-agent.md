---
title: Read owner agent
description: Read one of the signed-in owner's agents.
operation:
  method: GET
  path: /internal/owners/{ownerId}/agents/{agentId}
  server: https://relay
  parameters:
    - name: ownerId
      in: path
      type: string
      description: The owner ID from the verified session.
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
      description: Must equal `ownerId`.
  responses:
    '200':
      contentType: application/json
      description: Returns the agent.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: The agent does not exist or belongs to another owner.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L38
  - label: Agent schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L41
  - label: Agent serialization
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L50
---

`Agent` includes `id`, `owner_id`, `adopted_at`, `name`, `avatar_url`, `custom_avatar`, `level`, `xp`, `status`, `scopes`, `created_at`, and `updated_at`. Status is `active`, `off`, `suspended`, or `banned`. The returned avatar URL points at the relay's custom copy or generated sigil.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const { agent } = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001`);
```

The agent ID is fictitious. Use one of the owner's actual agents. See [authentication](../index.md#authentication-and-session-forwarding).
