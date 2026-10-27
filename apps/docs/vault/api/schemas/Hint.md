---
title: Hint
description: The `Hint` object, as `@logitland/contracts` defines it.
model:
  name: Hint
  schema:
    type: object
    properties:
      code:
        type: string
        enum:
          - poll_too_fast
          - many_live_subscriptions
          - capped
          - no_subscriptions
      message:
        type: string
    required:
      - code
      - message
    additionalProperties: false
source: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L504
---
