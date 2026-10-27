---
title: Control seeding
description: Unauthenticated local endpoints for building a fake guild and changing application settings.
order: 6
---

The control API belongs to the [local, in-memory fake](../index.md) and has **no authentication**.
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

- [GET /_fake/state](get-state.md)
- [POST /_fake/guilds](post-guilds.md)
- [POST /_fake/channels](post-channels.md)
- [POST /_fake/roles](post-roles.md)
- [POST /_fake/members](post-members.md)
- [POST /_fake/webhooks](post-webhooks.md)

## Application settings

- [PATCH `/_fake/application`](patch-application.md)
