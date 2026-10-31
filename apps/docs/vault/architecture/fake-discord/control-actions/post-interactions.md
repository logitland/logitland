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
          description: Required even for a ping; must be a member of the selected guild for non-ping interactions.
        guild:
          type: string
          description: Existing guild ID; defaults to the first guild.
        channel:
          type: string
          description: Defaults to the selected guild's first text channel; if none exists, channel fields are omitted from the payload.
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
          default: false
        endpoint:
          type: string
          description: Target URL; defaults to application.interactions_endpoint_url. Use a local test endpoint.
        signature:
          type: string
          default: valid
          enum:
            - valid
            - invalid
            - missing
        timestamp:
          type: number
          description: Signature timestamp in epoch seconds; defaults to the fake's current time.
    example:
      user: '100000000000000030'
      guild: '100000000000000010'
      channel: '100000000000000020'
      command:
        name: consent
        subcommand: agree
      endpoint: http://127.0.0.1:8787/v1/discord/interactions
  responses:
    '200':
      contentType: application/json
      description: An object with the target's status, its body (parsed JSON or raw text), and the interaction record.
    '400':
      description: Invalid input, missing setup, an unknown non-ping member, no action, or a transport failure.
      example:
        error: message
source:
  - label: send interaction
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L266-L281
  - label: interaction construction and defaults
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L84-L147
  - label: signature and response handling
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L149-L168
  - label: record fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L39-L57
  - label: relay consent command
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/interactions.ts#L33-L49
---

## Request setup

Seed a guild and configure a local test endpoint before sending an interaction, including a ping.
Configure the target to verify signatures against the fake's public key, not a production application's key.

Supply one action:

- `command` with `name` and optional `subcommand`.
- `button` with `customId` and optional `messageId`. The message is included only if it exists in the selected channel.
- `ping: true`.

If several actions are supplied, `ping: true` takes precedence, then `command`, then `button`.

## Signing

The fake signs `timestamp + body` with its Ed25519 key and sends `x-signature-ed25519` and `x-signature-timestamp`.
`signature: missing` omits both headers; `signature: invalid` corrupts the signature. The outbound request times out after 15 seconds.

## Response and follow-ups

The control request returns HTTP `200` even when the target rejects the interaction. Check the returned `status` for the target's HTTP status.
Only a target `2xx` response sets `interaction.acknowledged` to `true`.

A transport failure returns control HTTP `400`, but the record remains in the [interaction log](get-interactions.md) with `response: null`.
After acknowledgement, use the interaction token with the [interaction webhook branches](../webhooks/index.md#interaction-webhook-branches).
