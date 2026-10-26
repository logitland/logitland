---
title: Private backend contracts
description: Worker dispatch, private Durable Object WebSocket upgrades, internal RPC methods, and event handlers.
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

- [Default fetch(request, env, ctx)](./private-backend/default-fetch-request-env-ctx.md)
- [Named InternalApi.fetch(request)](./private-backend/named-internalapi-fetch-request.md)
- [Queue handler](./private-backend/queue-handler.md)
- [Scheduled handler](./private-backend/scheduled-handler.md)

## AgentStream.fetch

[AgentStream.fetch](./private-backend/agentstream-fetch.md)

## ShowcaseLive.fetch

[ShowcaseLive.fetch](./private-backend/showcaselive-fetch.md)

## Private RPC methods

- [DiscordGateway.ensure()](./private-backend/discordgateway-ensure.md)
- [DiscordGateway.status()](./private-backend/discordgateway-status.md)
- [ChannelSender.enqueue(messageId)](./private-backend/channelsender-enqueue-messageid.md)
- [AgentStream.notify()](./private-backend/agentstream-notify.md)
- [ShowcaseLive.publish(frames)](./private-backend/showcaselive-publish-frames.md)

## Platform callbacks

- [DiscordGateway.alarm()](./private-backend/discordgateway-alarm.md)
- [ChannelSender.alarm()](./private-backend/channelsender-alarm.md)
- [AgentStream.alarm()](./private-backend/agentstream-alarm.md)
- [ShowcaseLive.webSocketClose()](./private-backend/showcaselive-websocketclose.md)
