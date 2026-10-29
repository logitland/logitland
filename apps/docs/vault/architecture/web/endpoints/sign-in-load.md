---
title: '/sign-in'
description: The sign-in page's load. Sends signed-in people on to where they were going.
---

For a browser request such as `GET /sign-in?next=%2Fadmin`, a signed-in person redirects `303` to `next`.
The destination uses the same [`next` prefix check](get-auth-discord.md) as Discord sign-in and defaults to `/agents`.
Without a session, the page renders without extra load data.

Markdown requests receive [handwritten sign-in instructions](index.md#markdown-representations), even when a session exists;
the hook returns them before running this load.

[Sign-in load](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/sign-in/+page.server.ts#L5) · [Markdown dispatch](https://github.com/logitland/logitland/blob/main/apps/web/src/hooks.server.ts#L42)
