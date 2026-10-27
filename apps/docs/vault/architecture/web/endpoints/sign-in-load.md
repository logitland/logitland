---
title: '/sign-in'
description: The sign-in page's load. Sends signed-in people on to where they were going.
---

Already signed-in people redirect `303` to safe `next`, default `/agents`. Others render the page without extra load data. Example `GET /sign-in?next=%2Fadmin`.

[Sign-in load](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/sign-in/+page.server.ts#L5)
