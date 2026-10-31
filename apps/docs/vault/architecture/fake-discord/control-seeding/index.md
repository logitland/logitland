---
title: Seeding
description: Unauthenticated local endpoints for building a fake guild and changing application settings.
order: 6
source:
  - label: control dispatch and errors
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L462-L493
  - label: typed field helpers
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L21-L33
---

The control API belongs to the [local, in-memory fake](../index.md) and has **no authentication**.
Keep it on loopback: anyone who can reach it can read test credentials and change state.
All paths on this page start with `/_fake`.
Every successful control request returns `200` JSON, including changes and deletions.

Rejected input, invalid JSON, and world errors return `400` with `{"error":"message"}`.
Validation is partial, not a full JSON Schema check; do not rely on malformed or out-of-range values being rejected.
Unknown control paths and unsupported methods return `404` with the same shape.
The control handler parses JSON without checking Content-Type. Use `application/json` in clients.
An empty request body becomes `{}`. Optional fields read through the typed helpers treat `null` as omitted;
the application endpoint also supports explicit clearing.

## Seed a world

These examples use explicit IDs so later reference examples can reuse them.
Create a guild before its channels, roles, and members; create a channel before its webhook.
Seeding changes the world directly, without bot-token or Discord permission checks.

| Endpoint                                 | Purpose                                                      |
| ---------------------------------------- | ------------------------------------------------------------ |
| [GET /_fake/state](get-state.md)         | Inspect configuration, IDs, credentials, and counts.         |
| [POST /_fake/guilds](post-guilds.md)     | Create a guild with its owner and relay bot.                 |
| [POST /_fake/channels](post-channels.md) | Add a channel with optional tags and permission overwrites.  |
| [POST /_fake/roles](post-roles.md)       | Add a role with permissions and a position.                  |
| [POST /_fake/members](post-members.md)   | Add a user to a guild with optional roles.                   |
| [POST /_fake/bots](post-bots.md)         | Create an additional bot with its own token and application. |
| [POST /_fake/webhooks](post-webhooks.md) | Add a channel webhook and obtain its URLs.                   |

## Application settings

| Endpoint                                         | Purpose                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| [PATCH /_fake/application](patch-application.md) | Change the interaction endpoint, developer team, or message-content flags. |
