---
title: Send an interaction
description: Build a signed Discord interaction, send it to a target endpoint, and return its response.
operation:
  method: POST
  path: /_fake/interactions
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - user
      properties:
        user:
          type: string
        guild:
          type: string
        channel:
          type: string
        command:
          type: object
          properties:
            name:
              type: string
            subcommand:
              type: string
        button:
          type: object
          properties:
            customId:
              type: string
            messageId:
              type: string
        ping:
          type: boolean
        endpoint:
          type: string
        signature:
          type: string
          enum:
            - valid
            - invalid
            - missing
        timestamp:
          type: number
    example:
      user: '100000000000000030'
      guild: '100000000000000010'
      channel: '100000000000000020'
      command:
        name: mirror
        subcommand: agree
      endpoint: http://127.0.0.1:8787/v1/discord/interactions
  responses:
    '200':
      contentType: application/json
      description: The target endpoint's status and body, with the interaction record.
    '400':
      description: Invalid input, missing setup, an unknown non-ping member, no action, or a transport failure.
      example:
        error: message
source:
  - label: send interaction
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L257
  - label: interaction construction and defaults
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L84
  - label: signature and response handling
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L149
  - label: record fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L39
---

POST requires a string `user`, even for a ping. Supply one of `command`, `button`, or `ping: true`. `command` contains `name` and optional `subcommand`. `button` contains `customId` and optional `messageId`; for example, the button click uses `customId` `agree` and message ID `100000000000000060`. `messageId` names a message in `channel` (`400` Unknown Message otherwise), and the payload carries it as `message`. When the target answers the click with `type: 7` (UPDATE_MESSAGE), the fake applies its `data` to that message, checked as a bot's message edit; an update Discord would refuse returns `400` with the reason, and the message stays as it was.

Optional `guild` defaults to the first guild. Optional `channel` defaults to the guild's first text channel, or `null` if none exists. Optional `endpoint` defaults to `application.interactions_endpoint_url`. `signature` accepts `valid` (default), `invalid`, or `missing`. `timestamp` defaults to the current epoch time in seconds.

The fake signs `timestamp + body` with Ed25519 and sends Discord signature headers. `missing` omits both signature headers. `invalid` corrupts the signature. The outbound request times out after 15 seconds.

Each record contains `id`, `token`, `type`, `user`, `payload`, numeric `createdAt`, `acknowledged`, `response`, and `followUps`. Any target `2xx` response marks it acknowledged. Use its token with the [interaction webhook branches](../webhooks/index.md#interaction-webhook-branches).

Another request body, button click:

```json
{
  "user": "100000000000000030",
  "button": {
    "customId": "agree",
    "messageId": "100000000000000060"
  }
}
```
