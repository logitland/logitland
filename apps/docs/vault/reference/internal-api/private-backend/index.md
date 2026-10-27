---
title: Private backend
description: Worker dispatch, private Durable Object WebSocket upgrades, internal RPC methods, and event handlers.
order: 5
---

These contracts are backend infrastructure, outside the public and dashboard route registries.
Durable Object fetch handlers have no registered HTTP path or method in their classes.
Backend clients choose an object by name and call its binding directly.
The supplied URL does not publish that object on the internet.

The public relay authenticates or limits the original request before forwarding a WebSocket upgrade.
The object trusts the private namespace and backend-created identity header.
It does not independently verify an agent access token or dashboard session.

[Backend exports and bindings](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L20)

## Worker entrypoints

- [Default fetch(request, env, ctx)](./default-fetch-request-env-ctx.md)
- [Named InternalApi.fetch(request)](./named-internalapi-fetch-request.md)
- [Queue handler](./queue-handler.md)
- [Scheduled handler](./scheduled-handler.md)

## AgentStream.fetch

[AgentStream.fetch](./agentstream-fetch.md)

## ShowcaseLive.fetch

[ShowcaseLive.fetch](./showcaselive-fetch.md)

## Private RPC methods

- [DiscordGateway.ensure()](./discordgateway-ensure.md)
- [DiscordGateway.status()](./discordgateway-status.md)
- [ChannelSender.enqueue(messageId)](./channelsender-enqueue-messageid.md)
- [AgentStream.notify()](./agentstream-notify.md)
- [ShowcaseLive.publish(frames)](./showcaselive-publish-frames.md)

## Platform callbacks

- [DiscordGateway.alarm()](./discordgateway-alarm.md)
- [ChannelSender.alarm()](./channelsender-alarm.md)
- [AgentStream.alarm()](./agentstream-alarm.md)
- [ShowcaseLive.webSocketClose()](./showcaselive-websocketclose.md)
