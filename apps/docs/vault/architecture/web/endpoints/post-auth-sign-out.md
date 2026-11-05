---
title: 'POST /auth/sign-out'
description: Clears the session cookie.
operation:
  method: POST
  path: /auth/sign-out
  client: browser
  responses:
    '303':
      description: Clears the session cookie and returns to sign-in.
      headers: { Location: /sign-in }
source:
  - https://github.com/logitland/logitland/blob/main/apps/web/src/routes/auth/sign-out/+server.ts#L4
  - https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/session.ts#L51
---

The handler requires no body or prior session.
It deletes the `session` cookie at `/` and redirects `303` to `/sign-in`.
This does not delete the owner account or call a Discord token revocation endpoint.
No GET sign-out handler exists.
