---
title: Fake Discord control actions
description: Simulate people, message changes, threads, roles, slash commands, and button clicks in local tests.
---

These [local control endpoints](control-seeding.md) have **no authentication**.
Every successful request returns `200` JSON. Input and world errors return `400 {"error":"message"}`.
Message and thread IDs in examples stand for IDs returned by earlier requests.
These actions let tests change the world directly; they do not use bot REST permission checks.

## People, messages, and threads

- [POST /_fake/messages](control-actions/post-messages.md)
- [GET /_fake/messages](control-actions/get-messages.md)
- [PATCH /_fake/messages/:channel/:id](control-actions/patch-messages-id-id.md)
- [DELETE /_fake/messages/:channel/:id](control-actions/delete-messages-id-id.md)
- [POST /_fake/messages/bulk-delete](control-actions/post-messages-bulk-delete.md)
- [POST /_fake/threads](control-actions/post-threads.md)
- [PATCH /_fake/threads/:id](control-actions/patch-threads-id.md)
- [DELETE /_fake/threads/:id](control-actions/delete-threads-id.md)
- [POST /_fake/members/:guild/:user/roles/:role](control-actions/post-members-id-id-roles-id.md)

## Interactions

- [POST /_fake/interactions](control-actions/post-interactions.md)
- [GET /_fake/interactions](control-actions/get-interactions.md)
