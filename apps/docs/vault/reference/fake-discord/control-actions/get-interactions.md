---
title: 'GET /_fake/interactions'
description: Fake Discord control actions endpoint GET /_fake/interactions.
---

[Fake Discord](../index.md) / [Fake Discord control actions](../control-actions.md)

Implements `GET /_fake/interactions`. This local control endpoint has no authentication.

## Request

- Method and path: `GET /_fake/interactions`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs and result: No inputs. Returns `{interactions: InteractionRecord[]}`.

## Response

Success returns `200` JSON.

No inputs. Returns `{interactions: InteractionRecord[]}`.

## Example

Use this request body with the method and path above when the example is body-only.

`GET /_fake/interactions`

## Source

[interaction log](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L274)

Each record contains `id`, `token`, `type`, `user`, `payload`, numeric `createdAt`, `acknowledged`, `response`, and `followUps`.
