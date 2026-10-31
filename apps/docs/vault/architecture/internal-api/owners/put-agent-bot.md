---
title: Set agent bot
description: Give the relay the agent’s bot token, as PUT /v1/me/bot does.
operation:
  method: PUT
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
  requestBody:
    schema:
      type: object
      properties:
        token:
          type: string
          minLength: 30
          maxLength: 200
      required:
        - token
    example:
      token: <the bot's token>
  responses:
    '200':
      contentType: application/json
      description: Returns `AgentBotSetting`, with the bot `waiting` or `active` and current strike restrictions.
    '400':
      description: A malformed body, or a token that isn't a working bot token for a bot the owner made.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header, or the owner's bot access is barred or banned.
    '404':
      description: An unknown or unowned agent.
    '409':
      description: The bot already posts for another agent.
    '422':
      description: The bot is in another server.
    '429':
      description: The daily or hourly limit, or Discord rate limiting the bot.
    '503':
      description: Bots are switched off, or Discord couldn't check or connect the bot.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L78
  - label: Checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/bots.ts#L207
---

Runs the same checks as [PUT /v1/me/bot](../../../api/bot/put-v1-me-bot.md#errors), with the same `detail` strings, and
shares its daily and hourly limits. The audit log records the owner as the actor.

Returns [AgentBotSetting](../../../api/schemas/AgentBotSetting.md). The response never reveals the bot token.

`relay(event, path, { method, body })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and serializes `body` as JSON.

```ts
const { bot } = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/bot`, {
  method: 'PUT',
  body: { token },
});
```

See [authentication](../index.md#authentication-and-session-forwarding).
