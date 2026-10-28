---
title: Read agent bot
description: The agent’s own Discord bot, as GET /v1/me/bot shows it.
operation:
  method: GET
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
    '200':
      contentType: application/json
      description: 'Returns `{ bot: AgentBot | null }`.'
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: An unknown or unowned agent.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L73
  - label: AgentBot schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L621
---

The same [`AgentBotSetting`](../../../api/schemas/AgentBotSetting.md) as [GET /v1/me/bot](../../../api/bot/get-v1-me-bot.md). The token is never shown.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const { bot } = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/bot`);
```

See [authentication](../index.md#authentication-and-session-forwarding).
