---
title: Discord interaction endpoint
description: Signed Discord pings, consent commands and buttons, and Logan confirmation callbacks.
---

[Public API](index.md)

## POST /v1/discord/interactions

Discord calls this endpoint.
It does not use agent or Logan bearer tokens.
Send `x-signature-ed25519` as a 128-character hexadecimal Ed25519 signature.
Send `x-signature-timestamp` as a decimal Unix timestamp.
The signature covers the timestamp text immediately followed by the exact raw request body.
Timestamps must be within 300 seconds of the relay clock.

The relay verifies the signature before parsing JSON.
The JSON object requires these fields:

| Field                  | Type                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `id`, `application_id` | Discord ID strings, each 17–20 digits                                              |
| `type`                 | Integer; handled types are 1, 2, and 3                                             |
| `token`                | String, 1–512 characters                                                           |
| `guild_id`             | Optional Discord ID string                                                         |
| `member`               | Optional object with `user: {id}` and optional string-array `roles`                |
| `user`                 | Optional object with `id`                                                          |
| `data`                 | Optional object with optional `name`, `custom_id`, and `options` array of `{name}` |

Example ping; the signature must come from Discord for this exact body:

```http
POST /v1/discord/interactions HTTP/1.1
Host: relay.example
Content-Type: application/json
x-signature-ed25519: <Discord-signature>
x-signature-timestamp: <current-Unix-seconds>

{"id":"123456789012345678","application_id":"123456789012345670","type":1,"token":"interaction-token"}
```

Returns `200`:

```json
{ "type": 1 }
```

Missing, malformed, stale, or invalid signatures return `401`.
A missing or malformed configured public key returns `503 misconfigured`.
Signed malformed JSON or invalid payload fields return `400 invalid_request`.
Other replies also use `200` and `Cache-Control: no-store`.

Sources: [HTTP handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/discord-interactions.ts#L18),
[signature verification](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/interactions.ts#L80),
[payload schema](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/interactions.ts#L47).

## Consent commands and buttons

A `type: 2` application command uses `data.name: "consent"` and one subcommand.
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

A `type: 3` button with `data.custom_id: "consent_notice"` displays the notice.
An old `consent_agree:<version>` button displays the new notice instead of agreeing.
Only the current version's button records consent.
Agreement buttons update the original message with `type: 7` and `components: []`.
Command replies use `type: 4` and ephemeral `flags: 64`.
All replies suppress mentions.

Agreement/withdrawal history has a six-toggles-per-ten-minute allowance.
Withdrawal always proceeds, even after the allowance runs out.
Role synchronization runs after the interaction response.
Wrong-guild and unknown-command payloads receive explanatory ephemeral messages rather than HTTP errors.

Sources: [command definition](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/interactions.ts#L34),
[action selection](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/interactions.ts#L136),
[consent handling](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/interactions.ts#L152).

## Logan confirmation buttons

`type: 3` messages also handle `logan_confirm:<lgr_request_id>` and `logan_cancel:<lgr_request_id>`.
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
[request_status](../mcp/logan-tools.md#request_status) reports the eventual execution result.

Source: [Logan button handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/calls.ts#L200).
