---
title: 'PATCH /webhooks/:id/:token/messages/:message'
description: Fake Discord webhook REST route for /webhooks/:id/:token/messages/:message.
---

[Fake Discord](../index.md) / [Webhooks](../webhooks.md)

Handles a webhook route using the token in the path. No Authorization header is required.

## Request

- Method and path: `PATCH /webhooks/:id/:token/messages/:message`.
- Auth: no Authorization header; the webhook token is in the path.
- Inputs and behavior: Optional `thread_id`. JSON fields `content` up to 2,000 characters and `embeds` up to ten entries. Omitted fields keep their values.

## Response

`200` edited Message. Same lookup errors as GET. `400/50006` if the resulting content, poll, and embeds are empty. Components do not satisfy this edit check.

## Example

`PATCH /api/v10/webhooks/100000000000000050/local-hook-token/messages/100000000000000060` with `{"content":"Edited"}`.

## Source

[webhook.message.edit](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L529)
