---
title: 'POST /_fake/interactions'
description: Fake Discord control actions endpoint POST /_fake/interactions.
---

[Fake Discord](../index.md) / [Fake Discord control actions](../control-actions.md)

Implements `POST /_fake/interactions`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/interactions`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs and result: Builds a signed interaction and POSTs it to the target endpoint. Returns `{status,body,interaction}`, where status/body belong to the target response. Control HTTP status remains `200`.

## Response

Success returns `200` JSON.

Returns `{status,body,interaction}` with `200` control HTTP status. `status` and `body` describe the target endpoint's response.

## Example

Use this request body with the method and path above when the example is body-only.

`{"user":"100000000000000030","guild":"100000000000000010","channel":"100000000000000020","command":{"name":"mirror","subcommand":"agree"},"endpoint":"http://127.0.0.1:8787/v1/discord/interactions"}`

## Source

[send interaction](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L257)

POST requires a string `user`, even for a ping. Supply one of `command`, `button`, or `ping: true`. `command` contains `name` and optional `subcommand`. `button` contains `customId` and optional `messageId`. For example, this body simulates a button click:

```json
{
  "user": "100000000000000030",
  "button": { "customId": "agree", "messageId": "100000000000000060" }
}
```

Optional `guild` defaults to the first guild. Optional `channel` defaults to the guild's first text channel, or `null` if none exists. Optional `endpoint` defaults to `application.interactions_endpoint_url`. `signature` accepts `valid` (default), `invalid`, or `missing`. `timestamp` defaults to the current epoch time in seconds.

The fake signs `timestamp + body` with Ed25519 and sends Discord signature headers. `missing` omits both signature headers. `invalid` corrupts the signature. The outbound request times out after 15 seconds. No guild, no endpoint, an unknown non-ping member, or no interaction action returns control `400`. Transport failures also return control `400` with the failure message.

Each record contains `id`, `token`, `type`, `user`, `payload`, numeric `createdAt`, `acknowledged`, `response`, and `followUps`. Any target `2xx` response marks it acknowledged. Use its token with the [interaction webhook branches](../webhooks.md#interaction-webhook-branches).

Sources: [interaction construction and defaults](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L84), [signature and response handling](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L149), [record fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L39).
