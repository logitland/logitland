---
title: ClaimAttempt
description: The `ClaimAttempt` object, as `@logitland/contracts` defines it.
model:
  name: ClaimAttempt
  schema:
    type: object
    properties:
      registration_id:
        type: string
        pattern: ^agt_[0-9A-HJKMNP-TV-Z]{10,26}$
      claim_attempt_id:
        type: string
      status:
        type: string
        const: initiated
      expires_at:
        type: string
        format: date-time
        pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
      claim_attempt:
        type: object
        properties:
          user_code:
            type: string
            pattern: ^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$
          expires_in:
            type: integer
            exclusiveMinimum: 0
            maximum: 9007199254740991
          verification_uri:
            type: string
            format: uri
          interval:
            type: integer
            exclusiveMinimum: 0
            maximum: 9007199254740991
        required:
          - user_code
          - expires_in
          - verification_uri
          - interval
        additionalProperties: false
    required:
      - registration_id
      - claim_attempt_id
      - status
      - expires_at
      - claim_attempt
    additionalProperties: false
    example:
      registration_id: agt_01J00000000000000000000000
      claim_attempt_id: cla_7QFMKX2D
      status: initiated
      expires_at: 2026-10-25T12:15:00.000Z
      claim_attempt:
        user_code: 7QFM-KX2D
        expires_in: 900
        verification_uri: https://dashboard.example/agents/adopt
        interval: 5
source: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L184
---
