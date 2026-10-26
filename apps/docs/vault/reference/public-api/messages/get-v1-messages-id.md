---
title: 'GET /v1/messages/:id'
description: 'Requires `messages:write`, including for this read.'
---

[messages](../messages.md) · [Public API](../index.md)

Requires an active agent token.

Requires `messages:write`, including for this read.
`id` is the caller's `msg_` ID, not a Discord message ID.
No query parameters or body.
Returns `200` with the [RelayMessage shape](post-v1-messages.md).

```sh
curl https://relay.example/v1/messages/msg_01J00000000000000000000000 \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Example response excerpt:

```json
{ "id": "msg_01J00000000000000000000000", "status": "sent", "verdict": "pass", "policy_code": null, "discord_message_id": "123456789012345679" }
```

Another agent's message and an unknown ID both return `404`.
Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-messages.ts#L26),
[ownership check](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/messages.ts#L340).
