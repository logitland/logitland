---
title: Configure rate limits
description: Change fake REST rate limits and clear existing bucket counts.
operation:
  method: POST
  path: /_fake/rate-limits
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      properties:
        enforce:
          type: boolean
        webhook:
          type: object
          properties:
            limit:
              type: number
              description: Requests allowed per window.
            windowMs:
              type: number
              description: Window length in milliseconds.
        default:
          type: object
          properties:
            limit:
              type: number
              description: Requests allowed per window.
            windowMs:
              type: number
              description: Window length in milliseconds.
    example:
      enforce: true
      webhook:
        limit: 2
        windowMs: 1000
  responses:
    '200':
      contentType: application/json
      description: The full rate-limit configuration.
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: rate-limit endpoint
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L450-L459
  - label: configuration defaults
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L165
  - label: configuration patch
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L497-L503
  - label: bucket keys
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L505-L532
---

Initial defaults are `enforce: false`, `webhook: {limit:5,windowMs:2000}`, and `default: {limit:50,windowMs:1000}`.
Omitted settings retain their current values; every call clears bucket counts, even with an empty patch.
The handler passes bucket patches through without type or range validation. Use positive numbers for `limit` and `windowMs`.

Webhook buckets are shared per webhook ID. Other buckets use the route's major parameter, falling back to `id` or the route's bucket name.
Recognized REST routes count requests and send rate-limit headers even when enforcement is off.
Enforced exhaustion returns REST `429` with `message`, `retry_after` in seconds, and `global: false`.
