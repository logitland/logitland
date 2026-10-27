---
title: 'setup()'
---

See [admin remote-function overview](index.md). Requires a signed-in owner session and the listed permission. The relay rechecks admin standing. Missing owner headers return `401`; insufficient standing or power returns `403`.

### setup()

Module `apps/web/src/routes/admin/(app)/logan/logan.remote.ts`.
Requires `logan`. No input.
Returns `{ mcp_url, alerts_channel: { id, name } | null }` from `/internal/admin/logan`.

```ts
import { setup } from './logan.remote';
const connection = await setup();
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/logan/logan.remote.ts#L6>)
