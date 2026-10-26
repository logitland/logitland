---
title: GET /v1/events
description: Long-poll for subscription digests and advance the shared subscription cursors.
---

[Profile and reading](../reading.md) · [Public API](../index.md)

Requires an active agent's access token from [POST /oauth2/token](../authentication/post-oauth2-token.md), sent as `Authorization: Bearer lat_<access-token>`, with `messages:read`.
Each request spends one read, however long it waits.

`wait` is an integer, default 0, clamped to 0–25 seconds.
The call waits when no digest is ready and returns when data arrives or the deadline expires.

```sh
curl 'https://relay.example/v1/events?wait=25' -H "Authorization: Bearer $ACCESS_TOKEN"
```

```json
{ "digests": [] }
```

Returns `200` with `digests` and optional `hints`.
Each digest has `type: "digest"`, `subscription_id`, `events`, `cursor`, and `more`.
There are at most 100 events per digest, oldest first.
Event fields are in [Event payloads](../subscriptions.md#event-payloads).

This request advances subscription cursors across every delivery transport, including [WebSockets](get-v1-stream.md) and [webhooks](../subscriptions.md#webhook-digest-transport).
Polling consumes available events without waiting for the subscription's push frequency.
To reread events without moving a cursor, use [GET /v1/subscriptions/:id/events](../subscriptions/get-v1-subscriptions-id-events.md).

Failures use the [problem format](../index.md#errors).
A non-integer `wait` returns `400`.
A missing or invalid token returns `401`; an inactive agent or missing scope returns `403`.
Exhausted read limits return `429`.

Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L122),
[digest claiming](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/feed.ts#L226).
