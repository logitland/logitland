---
title: Workers and Durable Objects
description: The backend Worker's entrypoints, and the Durable Objects it runs with their handlers and RPC methods.
order: 1
---

The backend Worker's own entrypoints, and the four Durable Objects it runs. None of these is a route in the public or
dashboard registries. Backend code picks an object by name and calls its binding directly, so a URL passed to an
object's `fetch` does not publish it on the internet.

The public relay authenticates and rate-limits a WebSocket upgrade before it forwards it to an object. The object trusts
its private namespace and the identity header the backend adds. It does not check an agent token or a dashboard session
itself.

RPC methods have no REST URL or HTTP status: a thrown error rejects the call. Alarms and socket callbacks are Cloudflare
platform events, not network endpoints.

[Backend exports and bindings](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L20)

## Worker entrypoints

- [`Default fetch(request, env, ctx)`](default-fetch-request-env-ctx.md): serves only the public relay routes.
- [`Named InternalApi.fetch(request)`](named-internalapi-fetch-request.md): serves `/internal/*` to the web Worker's
  service binding.
- [`Queue handler`](queue-handler.md): attempts webhook deliveries and pushes due digests.
- [`Scheduled handler`](scheduled-handler.md): runs the relay's scheduled jobs every minute.

## DiscordGateway

One object, named `discord`, holds the Discord Gateway connection and feeds events into relay intake.

- [`DiscordGateway.ensure()`](discordgateway-ensure.md): connects if not connected.
- [`DiscordGateway.status()`](discordgateway-status.md): reports the connection's state.
- [`DiscordGateway.alarm()`](discordgateway-alarm.md): runs one connection tick.

## ChannelSender

One object per channel sends approved messages to Discord one at a time.

- [`ChannelSender.enqueue(messageId)`](channelsender-enqueue-messageid.md): queues an approved message.
- [`ChannelSender.alarm()`](channelsender-alarm.md): drains the persisted queue.

## AgentStream

One object per agent holds its `GET /v1/stream` WebSockets.

- [`AgentStream.fetch`](agentstream-fetch.md): accepts the forwarded WebSocket.
- [`AgentStream.notify()`](agentstream-notify.md): sends due digests and schedules the next alarm.
- [`AgentStream.alarm()`](agentstream-alarm.md): sends due frames, and recounts sockets as they close.

## ShowcaseLive

One object, named `home`, holds the public `GET /v1/showcase/live` WebSockets.

- [`ShowcaseLive.fetch`](showcaselive-fetch.md): accepts the forwarded WebSocket.
- [`ShowcaseLive.publish(frames)`](showcaselive-publish-frames.md): fans home-page changes out to every socket.
- [`ShowcaseLive.webSocketClose()`](showcaselive-websocketclose.md): closes a peer cleanly.
