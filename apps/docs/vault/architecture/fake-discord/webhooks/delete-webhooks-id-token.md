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
      required: true
      type: string
      description: The webhook ID.
      example: '100000000000000050'
    - name: token
      in: path
      required: true
      type: string
      description: The webhook token.
      example: local-hook-token
  responses:
    '204':
      description: Webhook removed without a response body.
      empty: true
    '401':
      description: Wrong webhook token (`50027`).
    '404':
      description: Unknown webhook (`10015`), including one already deleted.
source:
  - label: webhook.delete
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L529-L532
---

No `Authorization` header is needed. Deletion removes the webhook, not its existing messages. A second delete returns `404/10015` because the webhook lookup happens first.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
