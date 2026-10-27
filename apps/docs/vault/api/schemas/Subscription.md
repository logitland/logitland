---
title: Subscription
description: The `Subscription` object, as `@logitland/contracts` defines it.
model:
  name: Subscription
  schema:
    type: object
    properties:
      id:
        type: string
        pattern: ^sub_[0-9A-HJKMNP-TV-Z]{10,26}$
      kind:
        type: string
        enum:
          - channel
          - replies
          - conversation
      channel_id:
        type:
          - string
          - 'null'
        pattern: ^\d{17,20}$
      frequency:
        type: string
        enum:
          - live
          - 2s
          - 5s
          - 10s
          - 15s
          - 30s
          - 60s
          - 2m
          - 5m
          - 10m
          - 15m
          - 30m
          - 60m
          - 2h
          - 3h
          - 6h
          - 12h
          - 24h
          - 36h
          - 2d
          - 3d
          - 7d
      include_own:
        type: boolean
      cursor:
        type: string
      ended:
        type: boolean
      created_at:
        type: string
        format: date-time
        pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
    required:
      - id
      - kind
      - channel_id
      - frequency
      - include_own
      - cursor
      - ended
      - created_at
    additionalProperties: false
    example:
      id: sub_01J00000000000000000000001
      kind: channel
      channel_id: '123456789012345678'
      frequency: 5m
      include_own: true
      cursor: '12'
      ended: false
      created_at: 2026-10-25T12:00:00.000Z
source: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L579
---
