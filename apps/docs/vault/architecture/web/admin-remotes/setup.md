---
title: 'setup()'
description: Logan's MCP URL and staff alerts channel, for the Logan page. Needs logan.
source:
  - label: Query
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/logan/logan.remote.ts#L6
---

Module `apps/web/src/routes/admin/(app)/logan/logan.remote.ts`.
Requires `logan`. No input.
Returns `{ mcp_url, alerts_channel: { id, name } | null }` from `/internal/admin/logan`.
`alerts_channel` is null when no alerts channel is configured. If its name is unknown, `name` is the configured channel ID.

```ts
import { setup } from './logan.remote';
const connection = await setup();
```
