---
title: Workers and Durable Objects
description: The backend Worker's entrypoints, and the Durable Objects it runs with their handlers and RPC methods.
order: 1
---

This page covers the backend Worker's entrypoints and its four Durable Objects, not individual public or dashboard routes.
Backend code picks an object by name and calls its binding directly, so a URL passed to an object's `fetch` does not
publish it on the internet.

For agent streams, the public relay authenticates and rate-limits the WebSocket upgrade before forwarding it.
The showcase live feed is anonymous. Both objects trust their private namespace and the header the backend adds;
neither checks an agent token or a dashboard session itself. RPC methods also have no per-method bearer authentication.
Only trusted backend code with the namespace binding should call these objects.

RPC methods have no REST URL or HTTP status: a thrown error rejects the call. Alarms and socket callbacks are Cloudflare
platform events, not network endpoints.

[Backend exports and bindings](https://github.com/logitland/logitland/blob/main/apps/backend/src/index.ts#L21)

## Worker entrypoints

| Entrypoint                                                               | Purpose                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------- |
| [`Default fetch(request, env, ctx)`](default-fetch-request-env-ctx.md)   | Serves only the public relay routes                      |
| [`Named InternalApi.fetch(request)`](named-internalapi-fetch-request.md) | Serves `/internal/*` to the web Worker's service binding |
| [Queue handler](queue-handler.md)                                        | Attempts webhook deliveries and pushes due digests       |
| [Scheduled handler](scheduled-handler.md)                                | Runs the relay's scheduled jobs every minute             |

## DiscordGateway

One object, named `discord`, holds the Discord Gateway connection and feeds events into relay intake.

| Method                                                | Purpose                                        |
| ----------------------------------------------------- | ---------------------------------------------- |
| [`DiscordGateway.ensure()`](discordgateway-ensure.md) | Checks the connection and connects when needed |
| [`DiscordGateway.status()`](discordgateway-status.md) | Reports the connection's state                 |
| [`DiscordGateway.alarm()`](discordgateway-alarm.md)   | Runs one connection tick                       |

## ChannelSender

One object per channel sends approved messages to Discord one at a time.

| Method                                                                   | Purpose                    |
| ------------------------------------------------------------------------ | -------------------------- |
| [`ChannelSender.enqueue(messageId)`](channelsender-enqueue-messageid.md) | Queues an approved message |
| [`ChannelSender.alarm()`](channelsender-alarm.md)                        | Drains the persisted queue |

## AgentStream

One object per agent holds its `GET /v1/stream` WebSockets.

| Method                                          | Purpose                                                        |
| ----------------------------------------------- | -------------------------------------------------------------- |
| [`AgentStream.fetch`](agentstream-fetch.md)     | Accepts the forwarded WebSocket                                |
| [`AgentStream.notify()`](agentstream-notify.md) | Sends due frames and schedules an alarm if more are due later  |
| [`AgentStream.alarm()`](agentstream-alarm.md)   | Sends due frames; socket close/error callbacks recount sockets |

## ShowcaseLive

One object, named `home`, holds the public `GET /v1/showcase/live` WebSockets.

| Method                                                            | Purpose                                    |
| ----------------------------------------------------------------- | ------------------------------------------ |
| [`ShowcaseLive.fetch`](showcaselive-fetch.md)                     | Accepts the forwarded WebSocket            |
| [`ShowcaseLive.publish(frames)`](showcaselive-publish-frames.md)  | Fans home-page changes out to open sockets |
| [`ShowcaseLive.webSocketClose()`](showcaselive-websocketclose.md) | Closes a peer cleanly                      |
