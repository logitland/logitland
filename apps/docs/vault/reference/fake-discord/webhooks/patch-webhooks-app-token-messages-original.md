---
title: 'PATCH /webhooks/:app/:token/messages/@original'
description: Fake Discord interaction webhook route for /webhooks/:app/:token/messages/@original.
---

[Fake Discord](../index.md) / [Webhooks](../webhooks.md)

Handles an interaction token branch.

## Request

- Method and path: `PATCH /webhooks/:app/:token/messages/@original`.
- Auth: interaction token in the path; it is valid for at most 15 minutes after the target endpoint succeeds.
- Inputs and result: Same fields. First edit creates the original message. Its flags default to ephemeral `64`; later zero/omitted flags preserve existing flags. Returns `200` Message.

## Response

Same fields. First edit creates the original message. Its flags default to ephemeral `64`; later zero/omitted flags preserve existing flags. Returns `200` Message.

## Example

`PATCH /api/v10/webhooks/100000000000000001/interaction-token/messages/@original` with `{"content":"Done"}`.

## Source

[editOriginal](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L216)

Interaction token branches are selected when `:id` is the fake application ID. The token comes from [a control interaction](../control-actions/post-interactions.md), after the target endpoint returns a successful HTTP response, and works for at most 15 minutes after creation. Unknown or expired tokens return `401/50027`; unacknowledged interactions return `404/10015`. These branches record messages on the interaction's `followUps`, outside the world's channel message list. There is no interaction-token GET branch; GET still looks up a normal webhook.

Sources: [token lookup](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177), [synthetic Message fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193).

Interaction token branches are selected when `:id` is the fake application ID. The token comes from [a control interaction](../control-actions/post-interactions.md), after the target endpoint returns a successful HTTP response, and works for at most 15 minutes after creation. Unknown or expired tokens return `401/50027`; unacknowledged interactions return `404/10015`. These branches record messages on the interaction's `followUps`, outside the world's channel message list. There is no interaction-token GET branch; GET still looks up a normal webhook.

Sources: [token lookup](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L177), [synthetic Message fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/interactions.ts#L193).
