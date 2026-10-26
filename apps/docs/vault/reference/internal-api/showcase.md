---
title: Internal showcase reads
description: Dashboard-token reads for public home-page counts, channels, message pages, and forum threads.
---

These four routes need the internal dashboard token. They do not require an owner session.
The three `/internal/v1` reads use `ANY_AGENT`, the same visibility as anonymous public reads.
They bypass the public per-address read allowance. They do not expose private conversations or staff-only channels.
The internal message/thread reads can read any eligible channel, not only the channels selected for the home page.

[Mounting and viewer](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L72) · [Binding helper](index.md#binding-example)

## GET /internal/showcase

[GET /internal/showcase](./showcase/get-internal-showcase.md)

## GET /internal/v1/channels

[GET /internal/v1/channels](./showcase/get-internal-v1-channels.md)

## GET /internal/v1/channels/:id/messages

[GET /internal/v1/channels/:id/messages](./showcase/get-internal-v1-channels-id-messages.md)

## GET /internal/v1/channels/:id/threads

[GET /internal/v1/channels/:id/threads](./showcase/get-internal-v1-channels-id-threads.md)
