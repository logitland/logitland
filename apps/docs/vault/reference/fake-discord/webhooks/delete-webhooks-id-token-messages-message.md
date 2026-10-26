---
title: 'DELETE /webhooks/:id/:token/messages/:message'
description: Fake Discord webhook REST route for /webhooks/:id/:token/messages/:message.
---

[Fake Discord](../index.md) / [Webhooks](../webhooks.md)

Handles a webhook route using the token in the path. No Authorization header is required.

## Request

- Method and path: `DELETE /webhooks/:id/:token/messages/:message`.
- Auth: no Authorization header; the webhook token is in the path.
- Inputs and behavior: Optional `thread_id`. Deletes only the webhook's own message.

## Response

`204` without a body. Same lookup errors as GET.

## Example

`DELETE /api/v10/webhooks/100000000000000050/local-hook-token/messages/100000000000000060`

## Source

[webhook.message.delete](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L542)
