---
title: DeliveriesPage
description: A newest-first page of webhook deliveries and their attempt logs.
model:
  name: DeliveriesPage
  schema:
    type: object
    properties:
      deliveries:
        type: array
        items:
          type: object
          properties:
            id:
              type: string
              pattern: ^del_[0-9A-HJKMNP-TV-Z]{10,26}$
            subscription_id:
              type: string
              pattern: ^sub_[0-9A-HJKMNP-TV-Z]{10,26}$
            event_count:
              type: integer
              minimum: 0
              maximum: 9007199254740991
            status:
              type: string
              enum:
                - pending
                - retrying
                - delivered
                - failed
                - dropped
            attempts:
              type: integer
              minimum: 0
              maximum: 9007199254740991
            next_attempt_at:
              type:
                - string
                - 'null'
              format: date-time
              pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
            last_status_code:
              type:
                - integer
                - 'null'
              minimum: -9007199254740991
              maximum: 9007199254740991
            last_error:
              type:
                - string
                - 'null'
            created_at:
              type: string
              format: date-time
              pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
            delivered_at:
              type:
                - string
                - 'null'
              format: date-time
              pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
            attempt_log:
              type: array
              items:
                type: object
                properties:
                  n:
                    type: integer
                    exclusiveMinimum: 0
                    maximum: 9007199254740991
                  started_at:
                    type: string
                    format: date-time
                    pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
                  status_code:
                    type:
                      - integer
                      - 'null'
                    minimum: -9007199254740991
                    maximum: 9007199254740991
                  error:
                    type:
                      - string
                      - 'null'
                  duration_ms:
                    type: integer
                    minimum: 0
                    maximum: 9007199254740991
                required:
                  - n
                  - started_at
                  - status_code
                  - error
                  - duration_ms
                additionalProperties: false
          required:
            - id
            - subscription_id
            - event_count
            - status
            - attempts
            - next_attempt_at
            - last_status_code
            - last_error
            - created_at
            - delivered_at
            - attempt_log
          additionalProperties: false
      next_before:
        type:
          - string
          - 'null'
        pattern: ^del_[0-9A-HJKMNP-TV-Z]{10,26}$
    required:
      - deliveries
      - next_before
    additionalProperties: false
    example:
      deliveries:
        - id: del_01J00000000000000000000000
          subscription_id: sub_01J00000000000000000000001
          event_count: 1
          status: delivered
          attempts: 1
          next_attempt_at: null
          last_status_code: 200
          last_error: null
          created_at: 2026-10-25T12:00:00.000Z
          delivered_at: 2026-10-25T12:00:01.000Z
          attempt_log:
            - n: 1
              started_at: 2026-10-25T12:00:00.000Z
              status_code: 200
              error: null
              duration_ms: 1000
      next_before: null
source: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1019
---
