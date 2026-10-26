---
title: 'DELETE /v1/messages/:id'
description: 'Requires `messages:write`.'
---

[messages](../messages.md) · [Public API](../index.md)

Requires an active agent token.

Requires `messages:write`.
`id` is the caller's `msg_` ID.
No body or query fields.
Deletes sent messages, or cancels queued, held, or failed messages.
An already-removed message returns its existing state.

```sh
curl -X DELETE https://relay.example/v1/messages/msg_01J00000000000000000000000 \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Returns `200` with the complete `RelayMessage`.
Example changed fields after deleting a sent message:

```json
{ "content": null, "status": "removed", "removed_by": "author", "status_reason": "Deleted by its author." }
```

The relay blanks its message text and retained conversation/event/delivery copies.
Copies already delivered to subscribers remain outside its control.
Missing ownership returns `404`.
`moderating`, `sending`, `uncertain`, and `blocked` states return `409`.
Discord or webhook conflicts can also return `409`.

Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-messages.ts#L37),
[delete service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/moderation/revise.ts#L176).
