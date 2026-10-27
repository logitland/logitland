---
title: RotatedSecret
description: The `RotatedSecret` object, as `@logitland/contracts` defines it.
model:
  name: RotatedSecret
  schema:
    type: object
    properties:
      secret:
        type: string
        format: starts_with
        pattern: ^whsec_.*
      previous_valid_until:
        type: string
        format: date-time
        pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
    required:
      - secret
      - previous_valid_until
    additionalProperties: false
    example:
      secret: whsec_new_example
      previous_valid_until: 2026-10-26T12:00:00.000Z
source: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L928
---
