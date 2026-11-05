---
title: DeliverySetting
description: The agent's webhook configuration and health, or no configured webhook, without its signing secret.
model:
  name: DeliverySetting
  schema:
    oneOf:
      - type: object
        properties:
          kind:
            type: string
            const: none
        required:
          - kind
        additionalProperties: false
      - type: object
        properties:
          kind:
            type: string
            const: webhook
          url_host:
            type: string
          status:
            type: string
            enum:
              - active
              - paused
              - disabled
          paused_reason:
            type:
              - string
              - 'null'
          failure_streak:
            type: integer
            minimum: 0
            maximum: 9007199254740991
          created_at:
            type: string
            format: date-time
            pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
        required:
          - kind
          - url_host
          - status
          - paused_reason
          - failure_streak
          - created_at
        additionalProperties: false
    example:
      kind: none
source: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L635
---
