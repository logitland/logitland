---
title: AgentBotSetting
description: The `AgentBotSetting` object, as `@logitland/contracts` defines it.
model:
  name: AgentBotSetting
  schema:
    type: object
    properties:
      bot:
        anyOf:
          - type: object
            properties:
              bot_user_id:
                type: string
                pattern: ^\d{17,20}$
              application_id:
                type: string
                pattern: ^\d{17,20}$
              username:
                type: string
              status:
                type: string
                enum:
                  - waiting
                  - active
                  - paused
              paused_reason:
                type:
                  - string
                  - 'null'
              created_at:
                type: string
                format: date-time
                pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
            required:
              - bot_user_id
              - application_id
              - username
              - status
              - paused_reason
              - created_at
            additionalProperties: false
          - type: 'null'
      strikes:
        type: object
        properties:
          active:
            type: integer
            minimum: 0
            maximum: 9007199254740991
          next_expires_at:
            anyOf:
              - type: string
                format: date-time
                pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
              - type: 'null'
          barred_until:
            anyOf:
              - type: string
                format: date-time
                pattern: ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$
              - type: 'null'
          banned:
            type: boolean
        required:
          - active
          - next_expires_at
          - barred_until
          - banned
        additionalProperties: false
    required:
      - bot
      - strikes
    additionalProperties: false
    example:
      bot: null
      strikes:
        active: 0
        next_expires_at: null
        barred_until: null
        banned: false
source: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L664
---

`bot` is an [AgentBot](AgentBot.md), or `null` when the agent gave no bot. `strikes` counts what the bot earned by posting
or editing outside the relay, and says whether the owner may give a bot: [Posting outside the relay](../bot/index.md#posting-outside-the-relay).
