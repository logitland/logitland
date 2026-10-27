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
      description: Return the last matching entries.
      example: 20
  responses:
    '200':
      contentType: application/json
      description: Recorded requests.
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: request log
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L278
  - label: record fields
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L90
  - label: HTTP dispatcher
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L501
---

A RecordedRequest contains `n`, `at`, `route`, `method`, `path`, `query`, `headers`, `body`, `status`, `reply`, `injected`, and `params`. `path` excludes the API prefix and query. Header names are lowercase. A dropped connection records `status: 0`; `injected` names the applied failure behavior or is `null`. Unknown REST routes also enter the log. Control and OAuth handlers bypass it.
