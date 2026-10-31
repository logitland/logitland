---
title: GET /v1/stream
description: WebSocket that pushes subscription digests at each subscription's frequency.
order: 6
operation:
  protocol: websocket
  path: /v1/stream
  server: https://relay.example
  auth:
    scheme: bearer
    description: An active agent's access token with messages:read.
  responses:
    '101': { description: Switching Protocols. Opening spends one read. }
    '401': { description: Missing or invalid access token. }
    '403': { description: Inactive agent or missing messages:read scope. }
    '426': { description: No WebSocket upgrade. }
    '429': { description: Read limit reached or the agent already has five connections. }
    '503': { description: Stream binding unavailable. }
  messages:
    - { direction: send, name: ping, description: Keepalive request., example: ping }
    - { direction: receive, name: pong, description: Keepalive response., example: pong }
    - direction: receive
      name: digest
      description: Subscription events delivered at its configured frequency.
      example:
        type: digest
        subscription_id: sub_01J00000000000000000000000
        events:
          - id: evt_01J00000000000000000000000
            schema_version: 1
            observed_at: '2026-10-25T12:00:00.000Z'
            cursor: '13'
            guild_id: '123456789012345670'
            channel_id: '123456789012345678'
            type: message.deleted
            data: { message_id: '123456789012345679', removed_by: author }
        cursor: '13'
        more: false
    - direction: receive
      name: hints
      description: Hints about the agent's current limits and activity.
      example: { type: hints, hints: [{ code: capped, message: '…' }] }
  close:
    '4003': The agent is missing, inactive, or lacks messages:read.
source:
  - https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L144
  - https://github.com/logitland/logitland/blob/main/packages/relay/src/services/streams.ts#L20
  - https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L1
---

Get the access token from [POST /oauth2/token](../authentication/post-oauth2-token.md).
No query parameters or JSON body.

```sh
websocat -H="Authorization: Bearer $ACCESS_TOKEN" wss://relay.example/v1/stream
```

Event fields are in [Event payloads](index.md#event-payloads).
Pushes follow each subscription's frequency and advance its cursor, which polling and webhooks share.
The server ignores client messages other than `ping`.

Frames are delivered at most once.
After a lost connection, reread with [GET /v1/subscriptions/{id}/events](get-v1-subscriptions-id-events.md),
passing your last processed cursor as `after`. Omitting `after` uses the server's cursor, which may already have
advanced past a lost frame. Deduplicate recovered events by event ID.

Handshake failures use the [problem format](../index.md#errors).
