---
title: 'GET /webhooks/:id/:token/messages/:message'
description: Fake Discord webhook REST route for /webhooks/:id/:token/messages/:message.
---

[Fake Discord](../index.md) / [Webhooks](../webhooks.md)

Handles a webhook route using the token in the path. No Authorization header is required.

## Request

- Method and path: `GET /webhooks/:id/:token/messages/:message`.
- Auth: no Authorization header; the webhook token is in the path.
- Inputs and behavior: Optional `thread_id` query selects a thread belonging to the webhook's parent channel.

## Response

`200` Message. `404/10008` for a missing message or another author's message. Invalid thread returns `404/10003`; malformed thread ID returns `400/50035`.

## Example

`GET /api/v10/webhooks/100000000000000050/local-hook-token/messages/100000000000000060`

## Source

[webhook.message.get](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L524)
