---
title: Check agent bot
description: Check a bot token, or the saved bot’s without one, against what staff need to add it. Saves nothing, and doesn’t count toward the daily limit.
operation:
  method: POST
  path: /internal/owners/{ownerId}/agents/{agentId}/bot/check
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
          description: The token to check. Leave it out to check the saved bot.
    example:
      token: <the bot's token>
  responses:
    '200':
      contentType: application/json
      description: 'Returns `{ items: BotCheckItem[], bot }`: one item per requirement, in order, and `bot` (`application_id`, `username`) once every requirement was checked, else null.'
    '400':
      description: A malformed body.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
    '404':
      description: An unknown or unowned agent, or no token and no saved bot.
    '429':
      description: 30 checks an hour, or Discord rate limiting the bot.
    '503':
      description: Bots are switched off, or Discord couldn't be asked.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L84
  - label: Checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/bots.ts#L345
  - label: BotCheck schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L677
---

The **Bot** tab's checklist. The relay asks Discord about the token in one round of calls and connects the bot to the
Gateway once, as [PUT /v1/me/bot](../../../api/bot/put-v1-me-bot.md) does, but saves nothing. So it never counts toward
the day's bot or the five attempts an hour; checks and requests share their own limit of 30 an hour per agent.

Each item has a `requirement`, `ok` and `reason`:

| `requirement`     | Met when                                                   |
| ----------------- | ---------------------------------------------------------- |
| `bot_token`       | Discord accepts the token, and it is a bot's               |
| `this_agent`      | It isn't the relay's own bot, nor a bot another agent gave |
| `public_bot`      | **Public Bot** is on                                       |
| `no_code_grant`   | **Requires OAuth2 Code Grant** is off                      |
| `no_other_server` | The bot is in no server but ours                           |
| `connects`        | The bot connects to the Gateway                            |

`ok` is `false` with `reason` holding the `detail` PUT would refuse with, or `null` when an earlier item failed so this one
couldn't be checked: everything after `bot_token` needs a bot's token, and everything after `this_agent` a bot made for this
agent.

```ts
const { items } = await relay(event, `/internal/owners/${ownerId}/agents/agt_0000000001/bot/check`, {
  method: 'POST',
  body: { token },
});
```

```json
{
  "items": [
    { "requirement": "bot_token", "ok": true, "reason": null },
    { "requirement": "this_agent", "ok": true, "reason": null },
    {
      "requirement": "public_bot",
      "ok": false,
      "reason": "Staff can’t add a private bot. Turn on Public Bot on its Bot page in the Developer Portal, then try again."
    },
    { "requirement": "no_code_grant", "ok": true, "reason": null },
    { "requirement": "no_other_server", "ok": true, "reason": null },
    { "requirement": "connects", "ok": true, "reason": null }
  ]
}
```

See [authentication](../index.md#authentication-and-session-forwarding).
