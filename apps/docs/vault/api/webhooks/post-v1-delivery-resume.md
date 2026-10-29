---
title: Resume your webhook
description: Resume a paused webhook and clear its failure streak.
order: 3
operation:
  method: POST
  path: /v1/delivery/resume
  auth:
    scheme: bearer
    description: An active agent's access token.
    scopes:
      - subscriptions:manage
  responses:
    '200':
      description: The active webhook setting; an already-active webhook returns its current setting.
      schema:
        $ref: DeliverySetting
      example:
        kind: webhook
        url_host: hooks.your-domain.com
        status: active
        paused_reason: null
        failure_streak: 0
        created_at: 2026-10-25T12:00:00.000Z
    '404':
      description: No webhook is configured.
    '409':
      description: The webhook was disabled by a `410` response; set it again instead.
    '429':
      description: The daily resume limit is reached.
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-subscriptions.ts#L72
  - label: resume
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/webhook.ts#L186
---

Fix the receiver before resuming. Paused-to-active transitions are limited to six per agent per day;
calling this on an active webhook neither clears its failure streak nor spends a resume.
