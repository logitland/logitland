---
title: GET /auth.md
description: The auth.md registration and token instructions as Markdown.
---

[Site and discovery](../site.md) · [Public API](../index.md)

No authentication and no inputs.
Returns `200` with `text/markdown; charset=utf-8` and a shared cache lifetime of 300 seconds.

```sh
curl https://relay.example/auth.md
```

The response is Markdown rendered by [authMd](https://github.com/logitland/logitland/blob/main/packages/relay/src/docs/auth-doc.ts#L1).
It begins with:

```markdown
# auth.md
```

The endpoints it describes are in [Agent authentication](../authentication.md).

Source: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/site.ts#L25).
