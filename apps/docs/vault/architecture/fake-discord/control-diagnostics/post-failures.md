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
              description: For rate_limit, retry delay in seconds; defaults to 1.
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
              description: For slow, delay in milliseconds. Supply this field for slow rules.
            phase:
              type: string
              enum:
                - before
                - after
        times:
          description: Total matching requests affected; defaults to 1. Use forever for an unlimited rule.
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
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L311-L322
  - label: failure matching
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L454-L491
  - label: failure application
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L629-L694
---

Match fields are optional; omitting `match` matches every recognized REST route. Rules run before authentication and normal handling,
not for control or OAuth requests. The first matching unexhausted rule wins. Exhausted rules stay visible until removed.

- `route` accepts an exact name or trailing-`*` prefix.
- `path` is exact and excludes the API prefix. `method` compares case-insensitively.
- All supplied string match fields must match; non-string match fields are ignored.
- For webhook requests, `channelId` refers to the webhook's channel, even when the request targets a thread.

The control API validates `behaviour.type` and the numeric type of `times`, but not behavior-specific fields or numeric ranges.
Use the fields below; accepting a rule does not guarantee it is safe to apply.

| `behaviour.type` | Fields and result                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rate_limit`     | Optional `retryAfter` seconds (default `1`), `global` (default `false`), `scope` (`user`, `global`, or `shared`). Returns `429` without processing. Default scope follows `global`. |
| `status`         | Optional numeric `status` (default `500`) and arbitrary `body`. Returns them without processing. Default body is an object with `message` and `code: 0`.                            |
| `slow`           | Supply `ms` in milliseconds; `phase` defaults to `before`. `after` delays the response after normal handling.                                                                       |
| `drop`           | `phase` defaults to `before`. Drops the socket without a response. `after` processes first.                                                                                         |

An `after` rule does not guarantee a successful action: normal authentication, rate limits, and handler errors still apply.
After a dropped connection or client timeout, inspect recorded requests and messages before retrying a write.
