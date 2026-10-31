---
title: 'setup()'
description: Logan's MCP URL and staff log channel, for the Logan page. Needs logan.
---

Module `apps/web/src/routes/admin/(app)/logan/logan.remote.ts`.
Requires `logan`. No input.
Returns `{ mcp_url, staff_log_channel: { id, name } | null }` from `/internal/admin/logan`.

```ts
import { setup } from './logan.remote';
const connection = await setup();
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/logan/logan.remote.ts#L6>)
