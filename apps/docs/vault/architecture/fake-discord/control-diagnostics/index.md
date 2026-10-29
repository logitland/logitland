---
title: Diagnostics
description: Request logs, injected failures, resets, and rate limits for the local fake.
order: 9
source:
  - label: unauthenticated control dispatch
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L536-L541
  - label: control responses and errors
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L462-L493
---

These [local control endpoints](../control-seeding/index.md) have **no authentication**.
Keep the fake on loopback: logs can expose tokens and request content, and these endpoints can change or clear state.
Success returns `200` JSON. Rejected input returns `400 {"error":"message"}`; unknown paths and unsupported methods return `404` with the same shape.

## Requests and clearing

| Endpoint                                     | Purpose                                                               |
| -------------------------------------------- | --------------------------------------------------------------------- |
| [GET /_fake/requests](get-requests.md)       | Inspect recorded REST requests.                                       |
| [DELETE /_fake/requests](delete-requests.md) | Clear only the request log.                                           |
| [POST /_fake/clear](post-clear.md)           | Clear diagnostics and bucket counts, optionally messages and threads. |

## Failure rules

| Endpoint                                            | Purpose                                                |
| --------------------------------------------------- | ------------------------------------------------------ |
| [GET /_fake/failures](get-failures.md)              | Inspect rules and hit counts.                          |
| [POST /_fake/failures](post-failures.md)            | Inject a failure or delay into matching REST requests. |
| [DELETE /_fake/failures](delete-failures.md)        | Remove all failure rules.                              |
| [DELETE /_fake/failures/:id](delete-failures-id.md) | Remove one rule.                                       |

## Rate limits

| Endpoint                                       | Purpose                                 |
| ---------------------------------------------- | --------------------------------------- |
| [POST /_fake/rate-limits](post-rate-limits.md) | Change enforcement and bucket settings. |
