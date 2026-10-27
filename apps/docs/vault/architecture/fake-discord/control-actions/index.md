---
title: Simulation
description: Simulate people, message changes, threads, roles, slash commands, and button clicks in local tests.
order: 7
---

These [local control endpoints](../control-seeding/index.md) have **no authentication**.
Every successful request returns `200` JSON. Input and world errors return `400 {"error":"message"}`.
Message and thread IDs in examples stand for IDs returned by earlier requests.
These actions let tests change the world directly; they do not use bot REST permission checks.

## People, messages, and threads

- [POST /_fake/messages](post-messages.md)
- [GET /_fake/messages](get-messages.md)
- [PATCH /_fake/messages/:channel/:id](patch-messages-id-id.md)
- [DELETE /_fake/messages/:channel/:id](delete-messages-id-id.md)
- [POST /_fake/messages/bulk-delete](post-messages-bulk-delete.md)
- [POST /_fake/threads](post-threads.md)
- [PATCH /_fake/threads/:id](patch-threads-id.md)
- [DELETE /_fake/threads/:id](delete-threads-id.md)
- [POST /_fake/members/:guild/:user/roles/:role](post-members-id-id-roles-id.md)

## Interactions

- [POST /_fake/interactions](post-interactions.md)
- [GET /_fake/interactions](get-interactions.md)
