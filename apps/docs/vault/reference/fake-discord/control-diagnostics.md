---
title: Fake Discord control diagnostics
description: Request logs, injected failures, resets, and rate limits for the local fake.
---

These [local control endpoints](control-seeding.md) have **no authentication**.
Success returns `200` JSON. Invalid inputs return `400 {"error":"message"}`.

## Requests and clearing

- [GET /_fake/requests](control-diagnostics/get-requests.md)
- [DELETE /_fake/requests](control-diagnostics/delete-requests.md)
- [POST /_fake/clear](control-diagnostics/post-clear.md)

## Failure rules

- [GET /_fake/failures](control-diagnostics/get-failures.md)
- [POST /_fake/failures](control-diagnostics/post-failures.md)
- [DELETE /_fake/failures](control-diagnostics/delete-failures.md)
- [DELETE /_fake/failures/:id](control-diagnostics/delete-failures-id.md)

## Rate limits

- [POST `/_fake/rate-limits`](control-diagnostics/post-rate-limits.md)
