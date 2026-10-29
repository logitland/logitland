---
title: Webhooks
description: Webhook identity, execution, message changes, and interaction follow-up behavior in the local fake.
order: 3
source:
  - label: webhook routes and interaction dispatch
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L525-L625
  - label: token lookup
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177-L184
  - label: synthetic Message fields and storage
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193-L250
---

These routes belong to the [local fake](../index.md). Prefix paths with `/api/v10`; `/api/v9` and `/api` also work. Normal webhook routes use the token in the path and require no `Authorization` header. Unknown webhooks return `404/10015`; a wrong token returns `401/50027`.

Create a webhook with [`POST /_fake/webhooks`](../control-seeding/post-webhooks.md) or [`POST /channels/:channel/webhooks`](../messages-threads/post-channel-webhooks.md). Use its returned ID and token in place of the example values. JSON body errors, rate-limit headers, and injected failures follow the [shared REST rules](../index.md#rest-authentication-and-responses).

## Webhook requests

| Route                                                                                           | Purpose                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [GET `/webhooks/:id/:token`](get-webhooks-id-token.md)                                          | Read webhook identity and token.                                          |
| [DELETE `/webhooks/:id/:token`](delete-webhooks-id-token.md)                                    | Remove the webhook, retaining existing messages.                          |
| [POST `/webhooks/:id/:token`](post-webhooks-id-token.md)                                        | Execute in the channel or a thread; optionally create a forum/media post. |
| [GET `/webhooks/:id/:token/messages/:message`](get-webhooks-id-token-messages-message.md)       | Read one of the webhook's messages.                                       |
| [PATCH `/webhooks/:id/:token/messages/:message`](patch-webhooks-id-token-messages-message.md)   | Edit content or embeds.                                                   |
| [DELETE `/webhooks/:id/:token/messages/:message`](delete-webhooks-id-token-messages-message.md) | Delete one of the webhook's messages.                                     |

For message GET, PATCH, and DELETE, include `thread_id` if the message lives in a thread, including a forum/media post. The thread must belong to the webhook's parent channel. Without it, the fake searches only the parent channel's messages. A webhook can read or change only messages with its own `webhook_id`; otherwise the fake returns `404/10008`.

## Execute body

See the [webhook execute body rules](post-webhooks-id-token.md#execute-body).

## Interaction webhook branches

When `:id` equals the fake application's ID, POST, PATCH, and message DELETE use an interaction token. The token comes from [a control interaction](../control-actions/post-interactions.md), not a seeded webhook. Wait for the target endpoint's successful HTTP response before calling these routes. A token more than 15 minutes old is expired. Unknown or expired tokens return `401/50027`; unacknowledged interactions return `404/10015`.

| Route                                                                                             | Purpose                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [POST `/webhooks/:app/:token`](post-webhooks-app-token.md)                                        | Append a follow-up; always return a synthetic Message. |
| [PATCH `/webhooks/:app/:token/messages/@original`](patch-webhooks-app-token-messages-original.md) | Create or update the original-response record.         |
| [PATCH `/webhooks/:app/:token/messages/:message`](patch-webhooks-app-token-messages-message.md)   | Edit a stored message's content by ID.                 |
| [DELETE `/webhooks/:app/:token/messages/:message`](delete-webhooks-app-token-messages-message.md) | Remove a stored message by ID or `@original`.          |

These branches record messages on the interaction's `followUps`, outside the world's channel message list. They do not apply normal webhook message-body validation: POST and PATCH use only `content` and, where supported, `flags`. Omitted or `null` content becomes empty. There is no interaction-token GET branch; GET still looks up a normal webhook.
