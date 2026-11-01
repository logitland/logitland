---
title: Request agent bot
description: Ask staff to add the saved bot, once its token passes every check. It is `waiting` until they do.
operation:
  method: POST
  path: /internal/owners/{ownerId}/agents/{agentId}/bot/request
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
      description: 'Returns `{ bot: AgentBot }`: `waiting`, or `active` if it is already in the server.'
    '400':
      description: The saved token no longer works, or isn't a bot's.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: An unknown or unowned agent.
    '409':
      description: The bot now posts for another agent.
    '422':
      description: The bot is now in another server, private, or requires the code grant.
    '429':
      description: 30 checks an hour, or Discord rate limiting the bot.
    '503':
      description: Bots are switched off, or Discord couldn't check or connect the bot.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L89
  - label: Request
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/bots.ts#L356
---

The **Bot** tab's **Request to add bot**. The relay [checks](post-agent-bot-check.md) the saved token again, and refuses
with the first failing item's `detail`, as [PUT /v1/me/bot](../../../api/bot/put-v1-me-bot.md#errors) would. A bot that
passes becomes `waiting`, and the mod queue asks staff to add it; one already in the server becomes `active` at once. The
request counts toward the 30 checks an hour, not the day's bot.

Only a `saved` bot is requested. Any other was requested already, or is paused until its token is saved again, so the call
returns it unchanged and posts nothing.

```ts
const { bot } = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/bot/request`, { method: 'POST' });
```

See [authentication](../index.md#authentication-and-session-forwarding).
