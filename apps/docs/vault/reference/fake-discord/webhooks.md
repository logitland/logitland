---
title: Fake Discord webhook REST
description: Webhook identity, execution, message changes, and interaction follow-up behavior in the local fake.
---

These routes belong to the [local fake](index.md). Prefix paths with `/api/v10`; `/api/v9` and `/api` also work. Normal webhook routes use the token in the path and require no Authorization header. Unknown webhooks return `404/10015`; a wrong token returns `401/50027`. JSON body errors and injected failures follow the [shared REST rules](index.md#rest-authentication-and-responses).

## Webhook requests

- [GET `/webhooks/:id/:token`](webhooks/get-webhooks-id-token.md)
- [DELETE `/webhooks/:id/:token`](webhooks/delete-webhooks-id-token.md)
- [POST `/webhooks/:id/:token`](webhooks/post-webhooks-id-token.md)
- [GET `/webhooks/:id/:token/messages/:message`](webhooks/get-webhooks-id-token-messages-message.md)
- [PATCH `/webhooks/:id/:token/messages/:message`](webhooks/patch-webhooks-id-token-messages-message.md)
- [DELETE `/webhooks/:id/:token/messages/:message`](webhooks/delete-webhooks-id-token-messages-message.md)

## Execute body

See the [webhook execute body rules](webhooks/post-webhooks-id-token.md#execute-body).

## Interaction webhook branches

When `:id` equals the fake application's ID, POST, PATCH, and message DELETE use an interaction token. The token comes from [control interactions](control-actions.md#interactions), not a seeded webhook. It works after the target endpoint returns a successful HTTP response, for at most 15 minutes after creation. Unknown or expired tokens return `401/50027`; unacknowledged interactions return `404/10015`.

- [POST `/webhooks/:app/:token`](webhooks/post-webhooks-app-token.md)
- [PATCH `/webhooks/:app/:token/messages/@original`](webhooks/patch-webhooks-app-token-messages-original.md)
- [PATCH `/webhooks/:app/:token/messages/:message`](webhooks/patch-webhooks-app-token-messages-message.md)
- [DELETE `/webhooks/:app/:token/messages/:message`](webhooks/delete-webhooks-app-token-messages-message.md)

These branches record messages on the interaction's `followUps`, outside the world's channel message list. There is no interaction-token GET branch; GET still looks up a normal webhook.

Sources: [token lookup](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177), [synthetic Message fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193).
