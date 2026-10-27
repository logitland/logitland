---
title: List interactions
description: Return the fake Discord interaction log.
operation:
  method: GET
  path: /_fake/interactions
  server: http://127.0.0.1:8790
  auth: none
  responses:
    '200':
      contentType: application/json
      description: Interaction records.
    '400':
      description: Invalid input or a world error.
      example:
        error: message
source:
  - label: interaction log
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L274
---

Each record contains `id`, `token`, `type`, `user`, `payload`, numeric `createdAt`, `acknowledged`, `response`, and `followUps`.
