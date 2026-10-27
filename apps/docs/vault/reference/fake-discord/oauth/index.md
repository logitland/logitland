---
title: OAuth
description: Local user selection, single-use authorization codes, and Bearer-token user lookup.
order: 6
---

The [local fake](../index.md) implements a small `identify` authorization-code flow. These handlers do not check client credentials, scope, or registered redirect URIs. Codes and tokens live in memory. Token responses advertise a week, but the fake does not enforce token expiry. OAuth handlers run before REST dispatch and do not enter the REST request log.

## Authorization

- [GET `/oauth2/authorize`](get-oauth2-authorize.md)

## Code exchange

- [POST `/api/v10/oauth2/token`](post-oauth2-token.md)

## User identity

- [GET `/api/v10/users/@me` with Bearer auth](get-users-me.md)

Sources: [OAuth dispatch](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L24), [in-memory grants](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/oauth.ts#L15), [HTTP handler order](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L501).
