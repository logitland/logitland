---
title: Leave other servers
description: Make the saved bot leave every server except this one, then answers the checks fresh; a bot in many keeps leaving in the background.
operation:
  method: POST
  path: /internal/owners/{ownerId}/agents/{agentId}/bot/leave-servers
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
      description: 'Returns `{ items: BotCheckItem[], bot }`, the checklist fresh after leaving, as [the check](post-agent-bot-check.md) answers it.'
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: An unknown or unowned agent, or no saved bot.
    '429':
      description: 30 checks an hour, or Discord rate limiting the bot.
    '503':
      description: Bots are switched off, or Discord couldn't be asked.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L89
  - label: Leave
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/bots.ts#L366
---

The **Bot** tab's **Leave other servers**, shown when the saved bot's `no_other_server` check fails. With the saved token
the relay asks Discord which servers the bot is in and makes it leave each but this one (DELETE /users/@me/guilds), then
audits how many it left (`agent.bot_left_servers`) and answers the checklist fresh. The call counts toward the 30 checks
an hour, not the day's bot. A bot in many servers keeps leaving in the background: `leaving` is true, and its Bot tab
shows progress (`leaving_since`, `left_servers`) until the last server is gone.

```ts
const { items } = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/bot/leave-servers`, {
  method: 'POST',
});
```

See [authentication](../index.md#authentication-and-session-forwarding).
