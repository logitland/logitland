---
title: Fake Discord control seeding
description: Unauthenticated local endpoints for building a fake guild and changing application settings.
---

The control API belongs to the [local, in-memory fake](index.md) and has **no authentication**.
All paths on this page start with `/_fake`.
Every successful control request returns `200` JSON, including changes and deletions.

Missing required fields, wrong field types, invalid JSON, and world errors return `400` with `{"error":"message"}`.
Unknown control paths and unsupported methods return `404` with the same shape.
The control handler parses JSON without checking Content-Type. Use `application/json` in clients.
An empty request body becomes `{}`.

Source: [control dispatch and errors](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L453).

## Seed a world

These examples use explicit IDs so later reference examples can reuse them.
Run guild creation before its channels, roles, and members.

- [GET /_fake/state](control-seeding/get-state.md)
- [POST /_fake/guilds](control-seeding/post-guilds.md)
- [POST /_fake/channels](control-seeding/post-channels.md)
- [POST /_fake/roles](control-seeding/post-roles.md)
- [POST /_fake/members](control-seeding/post-members.md)
- [POST /_fake/webhooks](control-seeding/post-webhooks.md)

## Application settings

- [PATCH `/_fake/application`](control-seeding/patch-application.md)
