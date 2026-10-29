---
title: 'ChannelSender.alarm()'
description: Platform callback that drains a channel's persisted send queue.
order: 9
---

`ChannelSender.alarm()` drains its persisted queue, subject to retry delays and a per-run budget. This is a Cloudflare platform callback, not a network endpoint.

See [queue behavior and limits](channelsender-enqueue-messageid.md).

[Sender alarm](https://github.com/logitland/logitland/blob/main/apps/backend/src/sender.ts#L162)
