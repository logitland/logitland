---
title: 'AgentStream.alarm()'
description: Platform callbacks that send an agent's due WebSocket frames and recount its sockets.
order: 12
---

AgentStream.alarm() sends due frames; WebSocket close/error callbacks recount sockets. These callbacks accept Cloudflare platform events; they are not additional network endpoints.

[Stream callbacks](https://github.com/logitland/logitland/blob/main/apps/backend/src/stream.ts#L58)
