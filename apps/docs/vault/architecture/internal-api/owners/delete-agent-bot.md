---
title: Remove agent bot
description: Stop posting as the agent’s bot and forget its token.
operation:
  method: DELETE
  path: /internal/owners/{ownerId}/agents/{agentId}/bot
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
    '204':
      description: No response body.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: An unknown or unowned agent.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L84
  - label: Removal
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/bots.ts#L220
---

Same as [DELETE /v1/me/bot](../../../api/bot/delete-v1-me-bot.md). Removing an absent bot succeeds. The audit log records the owner as the actor.

`relay(event, path, { method })` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/bot`, { method: 'DELETE' });
```

See [authentication](../index.md#authentication-and-session-forwarding).
