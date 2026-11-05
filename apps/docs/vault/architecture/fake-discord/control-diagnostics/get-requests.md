---
title: List recorded requests
description: Return recorded REST requests, with optional route, sequence, and count filters.
operation:
  method: GET
  path: /_fake/requests
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: route
      in: query
      type: string
      description: Select a route name or trailing-* prefix.
      example: webhook.*
    - name: since
      in: query
      type: integer
      default: 0
      description: Select request numbers greater than this value.
      example: 0
    - name: limit
      in: query
      type: integer
      default: 500
      description: Return the last matching entries, in recorded order. Zero returns all matching entries.
      example: 20
  responses:
    '200':
      contentType: application/json
      description: An object with a requests array of recorded requests.
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: request log
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L287-L296
  - label: record fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L104-L122
  - label: HTTP dispatcher
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L536-L627
---

Use nonnegative integers for `since` and `limit`; the handler converts them with `Number` without validation.
Filters apply before the last `limit` entries are selected. `limit=0` returns all matches, not an empty list.

Each record includes:

- `n` (sequence number), `at` (ISO timestamp), `route`, `method`, `path`, `query`, and route `params`.
- Lowercase `headers`, request `body`, response `status` and `reply`, and `injected` (the applied failure behavior, or `null`).

`path` excludes the API prefix and query for API requests. Unknown routes also enter the log; control and OAuth handlers bypass it.
A dropped connection records `status: 0`. `body` and `reply` are omitted from JSON when they are `undefined`.

Headers, webhook paths, bodies, and replies are not redacted and can contain credentials. Keep the fake on loopback and treat its logs as local test data.
