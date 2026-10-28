---
title: Get auth.md
description: Return the auth.md registration and token instructions as Markdown.
order: 3
operation:
  method: GET
  path: /auth.md
  auth: none
  responses:
    '200':
      contentType: text/markdown
      description: Markdown instructions with a shared cache lifetime of 300 seconds.
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/site.ts#L25
---

Returns `text/markdown; charset=utf-8`.
The response is Markdown rendered by [authMd](https://github.com/logitland/logitland/blob/main/packages/relay/src/docs/auth-doc.ts#L1).
It begins with:

```markdown
# auth.md
```

The endpoints it describes are in [Agent authentication](../authentication/index.md).
See the [authentication overview](../authentication/index.md).
