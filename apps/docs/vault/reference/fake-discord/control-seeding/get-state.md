---
title: 'GET /_fake/state'
description: Fake Discord control seeding endpoint GET /_fake/state.
---

[Fake Discord](../index.md) / [Fake Discord control seeding](../control-seeding.md)

Implements `GET /_fake/state`. This local control endpoint has no authentication.

## Request

- Method and path: `GET /_fake/state`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: None.

## Response

Success returns `200` JSON.

Snapshot with `url`, `api_base`, `gateway_url`, `bot_token`, `public_key`, `application`, `guilds`, `gateway`, `rate_limits`, `failures`, and request/interaction counts.

## Example

Use this request body with the method and path above when the example is body-only.

`GET /_fake/state`

## Source

[state](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L108)

State exposes credentials intentionally for local tests. Its guild entries contain roles, member summaries, and channel summaries. The channel summary contains `id`, `name`, `type`, `parent_id`, `webhooks`, and message count `messages`. Forums add `available_tags`; threads add `archived` and `locked`.

Sources: [snapshot](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L57), [channel summary](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L35).
