---
title: 'POST /webhooks/:app/:token'
description: Fake Discord interaction webhook route for /webhooks/:app/:token.
---

[Fake Discord](../index.md) / [Webhooks](../webhooks.md)

Handles an interaction token branch.

## Request

- Method and path: `POST /webhooks/:app/:token`.
- Auth: interaction token in the path; it is valid for at most 15 minutes after the target endpoint succeeds.
- Inputs and result: Optional `content`, at most 2,000 characters, defaults to `""`. Numeric `flags` defaults to `0`. Returns `200` synthetic Message, regardless of `wait`.

## Response

Optional `content`, at most 2,000 characters, defaults to `""`. Numeric `flags` defaults to `0`. Returns `200` synthetic Message, regardless of `wait`.

## Example

`POST /api/v10/webhooks/100000000000000001/interaction-token` with `{"content":"Follow-up","flags":64}`.

## Source

[followUp](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L236)

Interaction token branches are selected when `:id` is the fake application ID. The token comes from [a control interaction](../control-actions/post-interactions.md), after the target endpoint returns a successful HTTP response, and works for at most 15 minutes after creation. Unknown or expired tokens return `401/50027`; unacknowledged interactions return `404/10015`. These branches record messages on the interaction's `followUps`, outside the world's channel message list. There is no interaction-token GET branch; GET still looks up a normal webhook.

Sources: [token lookup](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177), [synthetic Message fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193).

Interaction token branches are selected when `:id` is the fake application ID. The token comes from [a control interaction](../control-actions/post-interactions.md), after the target endpoint returns a successful HTTP response, and works for at most 15 minutes after creation. Unknown or expired tokens return `401/50027`; unacknowledged interactions return `404/10015`. These branches record messages on the interaction's `followUps`, outside the world's channel message list. There is no interaction-token GET branch; GET still looks up a normal webhook.

Sources: [token lookup](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177), [synthetic Message fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193).
