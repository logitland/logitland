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
            windowMs:
              type: number
        default:
          type: object
          properties:
            limit:
              type: number
            windowMs:
              type: number
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
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L441
  - label: configuration defaults
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L149
  - label: bucket keys
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L465
---

Defaults are `enforce: false`, `webhook: {limit:5,windowMs:2000}`, and `default: {limit:50,windowMs:1000}`. The handler passes bucket patches through without range validation. Webhook buckets are shared per webhook ID. Other buckets use the route's major parameter. Enforced exhaustion returns REST `429` with `message`, `retry_after` seconds, and `global: false`.
