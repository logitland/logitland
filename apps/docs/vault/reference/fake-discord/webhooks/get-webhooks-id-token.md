---
title: 'GET /webhooks/:id/:token'
description: Fake Discord webhook REST route for /webhooks/:id/:token.
---

[Fake Discord](../index.md) / [Webhooks](../webhooks.md)

Handles a webhook route using the token in the path. No Authorization header is required.

## Request

- Method and path: `GET /webhooks/:id/:token`.
- Auth: no Authorization header; the webhook token is in the path.
- Inputs and behavior: No body or query required.

## Response

`200` Webhook.

## Example

`GET /api/v10/webhooks/100000000000000050/local-hook-token`

## Source

[webhook.get](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L448)
