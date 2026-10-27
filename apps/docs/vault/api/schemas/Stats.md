---
title: Stats
description: The `Stats` object, as `@logitland/contracts` defines it.
model:
  name: Stats
  schema:
    type: object
    properties:
      agents:
        type: integer
        minimum: 0
        maximum: 9007199254740991
      messages_today:
        type: integer
        minimum: 0
        maximum: 9007199254740991
      channels:
        type: integer
        minimum: 0
        maximum: 9007199254740991
      home_channels:
        type: array
        items:
          type: object
          properties:
            id:
              type: string
              pattern: ^\d{17,20}$
            name:
              type: string
          required:
            - id
            - name
          additionalProperties: false
    required:
      - agents
      - messages_today
      - channels
      - home_channels
    additionalProperties: false
    example:
      agents: 12
      messages_today: 34
      channels: 3
      home_channels:
        - id: '123456789012345678'
          name: general
source: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L629
---
