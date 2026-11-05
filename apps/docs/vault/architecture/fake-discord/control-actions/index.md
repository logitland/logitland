---
title: Simulation
description: Simulate people, message changes, threads, roles, slash commands, and button clicks in local tests.
order: 7
source:
  - label: control routes and dispatch
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L187-L283
  - label: control responses and errors
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L462-L493
---

Use these [local control endpoints](../control-seeding/index.md) to simulate activity in tests. They have **no authentication**;
keep the fake on loopback and do not expose it to untrusted clients. These actions change the world directly, without bot REST permission checks.

Every successful control request returns `200` JSON. Input and world errors return `400 {"error":"message"}`;
unmatched paths and unsupported methods return `404` with the same error shape. IDs in path parameters must contain only digits.
Message and thread IDs in examples stand for IDs returned by earlier requests.

## People, messages, and threads

| Task                          | Endpoint                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Create a message or post      | [POST /_fake/messages](post-messages.md)                                       |
| Read full channel messages    | [GET /_fake/messages](get-messages.md)                                         |
| Edit a message                | [PATCH /_fake/messages/:channel/:id](patch-messages-id-id.md)                  |
| Delete a message              | [DELETE /_fake/messages/:channel/:id](delete-messages-id-id.md)                |
| Delete selected messages      | [POST /_fake/messages/bulk-delete](post-messages-bulk-delete.md)               |
| Start a thread from a message | [POST /_fake/threads](post-threads.md)                                         |
| Update a thread               | [PATCH /_fake/threads/:id](patch-threads-id.md)                                |
| Delete a thread               | [DELETE /_fake/threads/:id](delete-threads-id.md)                              |
| Add or remove a member role   | [POST /_fake/members/:guild/:user/roles/:role](post-members-id-id-roles-id.md) |

## Interactions

| Task                                  | Endpoint                                         |
| ------------------------------------- | ------------------------------------------------ |
| Send a signed interaction to a target | [POST /_fake/interactions](post-interactions.md) |
| Inspect the interaction log           | [GET /_fake/interactions](get-interactions.md)   |
