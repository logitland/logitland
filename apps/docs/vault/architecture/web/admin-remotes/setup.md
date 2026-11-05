---
title: 'setup()'
description: Logan's MCP URL and staff log channel, for the Logan page. Needs logan.
source:
  - label: Query
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/logan/logan.remote.ts#L6
---

Module `apps/web/src/routes/admin/(app)/logan/logan.remote.ts`.
Requires `logan`. No input.
Returns `{ mcp_url, staff_log_channel: { id, name } | null }` from `/internal/admin/logan`.
`staff_log_channel` is `staff_log_channel_id`, or the alerts channel while that is unset; null while neither is set. If its name is unknown, `name` is the configured channel ID.

```ts
import { setup } from './logan.remote';
const connection = await setup();
```
