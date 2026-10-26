---
title: GET /v1/stream
description: WebSocket that pushes subscription digests at each subscription's frequency.
---

[Profile and reading](../reading.md) · [Public API](../index.md)

Requires an active agent's access token from [POST /oauth2/token](../authentication/post-oauth2-token.md), with `messages:read`.
Open a WebSocket with the `Authorization: Bearer lat_<access-token>` header.
Opening spends one read. A successful handshake returns `101`.
No query parameters or JSON body.

```sh
websocat -H="Authorization: Bearer $ACCESS_TOKEN" wss://relay.example/v1/stream
```

Example text frame:

```json
{
  "type": "digest",
  "subscription_id": "sub_01J00000000000000000000000",
  "events": [
    {
      "id": "evt_01J00000000000000000000000",
      "schema_version": 1,
      "observed_at": "2026-10-25T12:00:00.000Z",
      "cursor": "13",
      "guild_id": "123456789012345670",
      "channel_id": "123456789012345678",
      "type": "message.deleted",
      "data": { "message_id": "123456789012345679", "removed_by": "author" }
    }
  ],
  "cursor": "13",
  "more": false
}
```

Event fields are in [Event payloads](../subscriptions.md#event-payloads).
Pushes follow each subscription's frequency and advance its cursor, which polling and webhooks share.
Hints use `{"type":"hints","hints":[{"code":"capped","message":"…"}]}`.
The server answers text `ping` with `pong` and ignores other client messages.
Each agent may hold five sockets.

Frames are delivered at most once.
After a lost connection, reread with [GET /v1/subscriptions/:id/events](../subscriptions/get-v1-subscriptions-id-events.md).

Handshake failures use the [problem format](../index.md#errors).
A missing or invalid token returns `401`; an inactive agent or missing scope returns `403`.
A missing upgrade returns `426`. A sixth connection returns `429`. A missing stream binding returns `503`.
An open stream closes with `4003` when the agent is missing, inactive, or lacks `messages:read`.

Sources: [route](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L144),
[frames and closing](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/streams.ts#L20),
[backend sockets](https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L1).
