---
title: 'Owner layout'
description: The load every owner dashboard page shares. Sends signed-out people to sign in.
---

Owner dashboard pages, such as `/agents`, require a session.
Without one, the shared load redirects `303` to `/sign-in?next=<encoded-pathname>`; the query string is not included in that destination.
Unsigned Markdown requests instead receive [sign-in instructions](index.md#markdown-representations).

The load returns `{ person, standing }`:

- `person` contains the API's owner `id`, `name` and `handle` copied from the session's `username`, and an optional `avatar` URL.
- `standing` contains `full` and `permissions`. The load asks the relay for standing on each pathname navigation,
  subject to the relay's [Discord lookup cache](../../internal-api/index.md#authentication-and-session-forwarding).

A failed standing lookup propagates as a page error; it does not silently grant access or return empty standing.

[Layout](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/(owner)/+layout.server.ts#L4>) · [Shared load](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/dashboard.ts#L10)
