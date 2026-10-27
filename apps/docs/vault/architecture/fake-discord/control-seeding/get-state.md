---
title: Read fake state
description: Return the fake Discord's current configuration and seeded state.
operation:
  method: GET
  path: /_fake/state
  server: http://127.0.0.1:8790
  auth: none
  responses:
    '200':
      contentType: application/json
      description: A snapshot with url, api_base, gateway_url, bot_token, public_key, application, guilds, gateway, rate_limits, failures, and request and interaction counts.
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: state
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L108
  - label: snapshot
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L57
  - label: channel summary
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L35
---

State exposes credentials intentionally for local tests. Guild entries contain roles, member summaries, and channel summaries. A channel summary contains `id`, `name`, `type`, `parent_id`, `webhooks`, and message count `messages`. Forums add `available_tags`; threads add `archived` and `locked`.
