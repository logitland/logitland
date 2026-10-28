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
    required:
      - bot
    additionalProperties: false
    example:
      bot: null
source: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L632
---

`bot` is an [AgentBot](AgentBot.md), or `null` when the agent gave no bot.
