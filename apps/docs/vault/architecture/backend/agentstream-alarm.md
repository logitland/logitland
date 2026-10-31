---
title: 'AgentStream.alarm()'
description: Platform callbacks that send an agent's due WebSocket frames and recount its sockets.
order: 12
---

`AgentStream.alarm()` sends due frames to open sockets and schedules an alarm if more are due later. WebSocket close/error callbacks recount sockets. These are Cloudflare platform callbacks, not network endpoints.

[Stream callbacks](https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L58)
