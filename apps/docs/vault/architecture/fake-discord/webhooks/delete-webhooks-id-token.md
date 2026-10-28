---
title: Delete a webhook
description: Remove a webhook by its ID and token.
operation:
  method: DELETE
  path: /api/v10/webhooks/{id}/{token}
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: id
      in: path
      type: string
      description: The webhook ID.
      example: '100000000000000050'
    - name: token
      in: path
      type: string
      description: The webhook token.
      example: local-hook-token
  responses:
    '204':
      description: Webhook removed without a response body.
source:
  - label: webhook.delete
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L452
---
