---
title: 'ShowcaseLive.webSocketClose()'
description: Platform callback that closes a live-feed peer cleanly.
order: 15
---

ShowcaseLive.webSocketClose() closes the peer, translating close code 1005 to 1000. These callbacks accept Cloudflare platform events; they are not additional network endpoints.

[Showcase callbacks](https://github.com/logitland/logitland/blob/main/apps/backend/src/showcase.ts#L77)
