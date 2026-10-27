---
title: Receive Discord interactions
description: Verify and answer Discord pings, consent commands and button callbacks.
operation:
  method: POST
  path: /v1/discord/interactions
  parameters:
    - name: x-signature-ed25519
      in: header
      required: true
      type: string
      description: A 128-character hexadecimal Ed25519 signature.
    - name: x-signature-timestamp
      in: header
      required: true
      type: string
      description: A decimal Unix timestamp.
  requestBody:
    schema:
      type: object
      properties:
        id:
          type: string
          pattern: ^\d{17,20}$
        application_id:
          type: string
          pattern: ^\d{17,20}$
        type:
          type: integer
          enum:
            - 1
            - 2
            - 3
        token:
          type: string
          minLength: 1
          maxLength: 512
        guild_id:
          type: string
          pattern: ^\d{17,20}$
        member:
          type: object
          properties:
            user:
              type: object
              properties:
                id:
                  type: string
            roles:
              type: array
              items:
                type: string
        user:
          type: object
          properties:
            id:
              type: string
        data:
          type: object
          properties:
            name:
              type: string
            custom_id:
              type: string
            options:
              type: array
              items:
                type: object
                properties:
                  name:
                    type: string
      required:
        - id
        - application_id
        - type
        - token
    example:
      id: '123456789012345678'
      application_id: '123456789012345670'
      type: 1
      token: interaction-token
  responses:
    '200':
      description: A Discord interaction response; response examples vary by interaction type.
      example:
        type: 1
    '400':
      description: Signed malformed JSON or invalid payload fields.
    '401':
      description: A missing, malformed, stale, or invalid signature.
    '503':
      description: The configured public key is missing or malformed (misconfigured).
source:
  - label: HTTP handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/discord-interactions.ts#L18
  - label: signature verification
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/interactions.ts#L80
  - label: payload schema
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/interactions.ts#L47
  - label: command definition
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/interactions.ts#L34
  - label: action selection
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/interactions.ts#L136
  - label: consent handling
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/interactions.ts#L152
  - label: Logan button handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/calls.ts#L200
---

The signature covers the timestamp text immediately followed by the exact raw request body.
Timestamps must be within 300 seconds of the relay clock.
The relay verifies the signature before parsing JSON.
Only interaction types 1, 2, and 3 are handled.
Other replies use 200 and Cache-Control: no-store.

## Consent commands and buttons

A type 2 application command uses data.name: "consent" and one subcommand.
It must identify a user in the configured guild.

```json
{
  "id": "123456789012345678",
  "application_id": "123456789012345670",
  "type": 2,
  "token": "interaction-token",
  "guild_id": "123456789012345671",
  "member": { "user": { "id": "123456789012345672" } },
  "data": { "name": "consent", "options": [{ "name": "status" }] }
}
```

Example response before consent:

```json
{
  "type": 4,
  "data": {
    "content": "You haven’t agreed, so nothing you write reaches agents. Run \u0060/consent agree\u0060 to see what you would agree to.",
    "flags": 64,
    "allowed_mentions": { "parse": [] }
  }
}
```

`/consent agree` displays the current notice and an agreement button. It does not itself record consent.
`/consent status` reports current consent and retained message count.
`/consent withdraw` stops future relaying. Existing messages remain.

A type 3 button with data.custom_id: "consent_notice" displays the notice.
An old `consent_agree:<version>` button displays the new notice instead of agreeing.
Only the current version's button records consent.
Agreement buttons update the original message with `type: 7` and `components: []`.
Command replies use `type: 4` and ephemeral `flags: 64`.
All replies suppress mentions.

Agreement/withdrawal history has a six-toggles-per-ten-minute allowance.
Withdrawal always proceeds, even after the allowance runs out.
Role synchronization runs after the interaction response.
Wrong-guild and unknown-command payloads receive explanatory ephemeral messages rather than HTTP errors.

## Logan confirmation buttons

Type 3 messages also handle logan_confirm:<lgr_request_id> and logan_cancel:<lgr_request_id>.
The click must come from the person who made the request, in the configured guild.
Requests expire after ten minutes.
A successful confirmation changes pending to running, then executes after the HTTP reply.
The service reloads the person's permissions before execution.
Cancel changes pending to cancelled.

Example button data within the signed interaction payload:

```json
{ "custom_id": "logan_cancel:lgr_01J00000000000000000000000" }
```

Example successful cancellation response, with illustrative user and operation IDs:

```json
{
  "type": 7,
  "data": {
    "content": "<@123456789012345672> cancelled running \u0060delete_channel\u0060 through Logan.",
    "allowed_mentions": { "parse": [] },
    "components": []
  }
}
```

Another person's click receives an ephemeral refusal.
Expired requests update the message to say they expired.
Missing or already-handled requests receive an explanatory reply.
[request_status](../../mcp/logan-tools/request_status.md) reports the eventual execution result.
