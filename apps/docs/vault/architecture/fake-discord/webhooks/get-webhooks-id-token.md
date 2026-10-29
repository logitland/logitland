---
title: Get a webhook
description: Return a webhook by its ID and token.
operation:
  method: GET
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
    '200':
      contentType: application/json
      description: The Webhook object.
    '401':
      description: Wrong webhook token (`50027`).
    '404':
      description: Unknown webhook (`10015`).
source:
  - label: webhook.get
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L525-L527
---

Use the token from [`POST /_fake/webhooks`](../control-seeding/post-webhooks.md) or [`POST /channels/:channel/webhooks`](../messages-threads/post-channel-webhooks.md). No `Authorization` header is needed. The response includes the webhook token; treat it as a credential for this local fake.

[Shared REST rules](../index.md#rest-authentication-and-responses) cover rate-limit headers and injected failures.
