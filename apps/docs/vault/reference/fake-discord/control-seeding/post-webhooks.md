---
title: 'POST /_fake/webhooks'
description: Fake Discord control seeding endpoint POST /_fake/webhooks.
---

[Fake Discord](../index.md) / [Fake Discord control seeding](../control-seeding.md)

Implements `POST /_fake/webhooks`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/webhooks`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: Required `channel`. Optional `id`, `token`, `name` (default `Logitland`). Missing ID and token generate.

## Response

Success returns `200` JSON.

Webhook plus `url` in Discord format and `fakeUrl` pointing to this fake. Unknown channel returns `400`.

## Example

Use this request body with the method and path above when the example is body-only.

`{"channel":"100000000000000020","id":"100000000000000050","token":"local-hook-token","name":"Mirror"}`

## Source

[webhooks](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L176)

State summaries use the key `fake_url`; webhook creation uses the different key `fakeUrl`.

Source: [webhook creation result](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L327).
