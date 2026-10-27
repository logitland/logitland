---
title: Control diagnostics
description: Request logs, injected failures, resets, and rate limits for the local fake.
order: 6
---

These [local control endpoints](../control-seeding/index.md) have **no authentication**.
Success returns `200` JSON. Invalid inputs return `400 {"error":"message"}`.

## Requests and clearing

- [GET /_fake/requests](get-requests.md)
- [DELETE /_fake/requests](delete-requests.md)
- [POST /_fake/clear](post-clear.md)

## Failure rules

- [GET /_fake/failures](get-failures.md)
- [POST /_fake/failures](post-failures.md)
- [DELETE /_fake/failures](delete-failures.md)
- [DELETE /_fake/failures/:id](delete-failures-id.md)

## Rate limits

- [POST `/_fake/rate-limits`](post-rate-limits.md)
