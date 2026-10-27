---
title: Add a failure rule
description: Configure a rule that changes how matching fake Discord requests behave.
operation:
  method: POST
  path: /_fake/failures
  server: http://127.0.0.1:8790
  auth: none
  requestBody:
    schema:
      type: object
      required:
        - behaviour
      properties:
        match:
          type: object
          properties:
            route:
              type: string
            method:
              type: string
            path:
              type: string
            channelId:
              type: string
            webhookId:
              type: string
        behaviour:
          type: object
          required:
            - type
          properties:
            type:
              type: string
              enum:
                - rate_limit
                - status
                - slow
                - drop
            retryAfter:
              type: number
            global:
              type: boolean
            scope:
              type: string
              enum:
                - user
                - global
                - shared
            status:
              type: number
            body: {}
            ms:
              type: number
            phase:
              type: string
              enum:
                - before
                - after
        times:
          oneOf:
            - type: number
            - type: string
              enum:
                - forever
    example:
      match:
        route: webhook.execute
      behaviour:
        type: rate_limit
        retryAfter: 1.5
      times: 1
  responses:
    '200':
      contentType: application/json
      description: The created rule ID.
    '400':
      description: Invalid input or an unsupported behavior type.
      example:
        error: message
source:
  - label: add rule
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L302
  - label: failure matching and application
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L419
---

Match fields are optional. `route` accepts an exact name or trailing-`*` prefix; `path` is exact and excludes the API prefix. `method` compares case-insensitively. All supplied match fields must match. For webhook requests, `channelId` refers to the webhook's channel, even when the request targets a thread. The first matching unexhausted rule wins. Exhausted rules stay visible until removed.

| `behaviour.type` | Fields and result                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rate_limit`     | Optional `retryAfter` seconds (default `1`), `global` (default `false`), `scope` (`user`, `global`, or `shared`). Returns `429` without processing. Default scope follows `global`. |
| `status`         | Optional numeric `status` (default `500`) and arbitrary `body`. Returns them without processing. Default body is an object with `message` and `code: 0`.                            |
| `slow`           | Required `ms`; `phase` defaults to `before`. `after` delays the response after processing.                                                                                          |
| `drop`           | `phase` defaults to `before`. Drops the socket without a response. `after` processes first.                                                                                         |

Another request body, drop after processing:

```json
{
  "match": {
    "route": "webhook.execute"
  },
  "behaviour": {
    "type": "drop",
    "phase": "after"
  }
}
```
