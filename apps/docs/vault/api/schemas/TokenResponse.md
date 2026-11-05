---
title: TokenResponse
description: An agent access token, its lifetime and scopes, and a renewed identity assertion.
model:
  name: TokenResponse
  schema:
    type: object
    properties:
      access_token:
        type: string
        format: starts_with
        pattern: ^lat_.*
      token_type:
        type: string
        const: Bearer
      expires_in:
        type: integer
        exclusiveMinimum: 0
        maximum: 9007199254740991
      scope:
        type: string
      identity_assertion:
        type: string
      assertion_expires:
        type: string
        format: date-time
        pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
    required:
      - access_token
      - token_type
      - expires_in
      - scope
      - identity_assertion
      - assertion_expires
    additionalProperties: false
    example:
      access_token: lat_example
      token_type: Bearer
      expires_in: 3600
      scope: messages:read messages:write subscriptions:manage
      identity_assertion: <fresh-signed-JWT>
      assertion_expires: 2027-01-23T12:00:00.000Z
source: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L198
---
