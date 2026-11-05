---
title: 'ShowcaseLive.webSocketClose()'
description: Platform callback that closes a live-feed peer cleanly.
order: 15
---

`ShowcaseLive.webSocketClose()` closes the peer, translating close code `1005` to `1000`. This is a Cloudflare platform callback, not a network endpoint.

[Showcase callback](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L81)
