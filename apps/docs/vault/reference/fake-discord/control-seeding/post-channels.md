---
title: 'POST /_fake/channels'
description: Fake Discord control seeding endpoint POST /_fake/channels.
---

[Fake Discord](../index.md) / [Fake Discord control seeding](../control-seeding.md)

Implements `POST /_fake/channels`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/channels`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Required/default inputs: Required strings `guild`, `name`. Optional `id`, `kind` (default `text`), numeric `type` overriding kind, `parent`, `topic`, `tags`, `overwrites`.

## Response

Success returns `200` JSON.

Channel summary described below.

## Example

Use this request body with the method and path above when the example is body-only.

`{"guild":"100000000000000010","id":"100000000000000020","name":"general","kind":"text"}`

## Source

[channels](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L130)

Channel kinds are `text`, `voice`, `category`, `announcement`, `forum`, and `media`. Their numeric types are `0`, `2`, `4`, `5`, `15`, and `16`. Tags accept `id`, required `name`, and optional `moderated` (default `false`). Overwrites accept `id`, `type: "role" | "member"`, and decimal-string `allow` and `deny`, each defaulting to `"0"`.

This example creates a forum with an explicit tag ID:

```json
{
  "guild": "100000000000000010",
  "id": "100000000000000021",
  "name": "ideas",
  "kind": "forum",
  "tags": [{ "id": "100000000000000070", "name": "idea" }],
  "overwrites": [{ "id": "100000000000000010", "type": "role", "deny": "2048" }]
}
```

Sources: [channel types](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/model.ts#L4), [world defaults](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L134), [channel and tag creation](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/world.ts#L231).
