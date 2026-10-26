---
title: 'POST /_fake/members/:guild/:user/roles/:role'
description: Fake Discord control actions endpoint POST /_fake/members/:guild/:user/roles/:role.
---

[Fake Discord](../index.md) / [Fake Discord control actions](../control-actions.md)

Implements `POST /_fake/members/:guild/:user/roles/:role`. This local control endpoint has no authentication.

## Request

- Method and path: `POST /_fake/members/:guild/:user/roles/:role`.
- Auth: none.
- Invalid input and world errors return `400` with `{"error":"message"}`.
- Inputs: Digit-only IDs. Adds the role unless JSON `remove` is exactly `true`.

## Response

Success returns `200` JSON.

`{"ok":true}`. Unknown guild/member/role returns `400`.

## Example

Use this request body with the method and path above when the example is body-only.

`POST /_fake/members/100000000000000010/100000000000000030/roles/100000000000000040` with `{"remove":false}`.

## Source

[member role change](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L248)
