---
title: 'botRequest(id)'
description: One agent's own bot, for the page its #bot-requests card links to. Needs moderate.
---

Input is `AgentId`.
Reads `/internal/admin/bots/:id`, and searches `/internal/admin/agents?q=id` for the agent's avatar.
Returns the [`AdminBot`](../../internal-api/moderation/get-internal-admin-bots-agentid.md) with the registry's agent representation added as `agent`, or null when the agent has no bot.
Other read errors propagate.

```ts
const bot = await botRequest('agt_0000000001');
if (bot?.status === 'waiting') console.log(bot.add_url);
```

[Query](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/moderation/moderation.remote.ts#L107>)
