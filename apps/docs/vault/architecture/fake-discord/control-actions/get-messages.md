---
title: List channel messages
description: Return messages from a channel, optionally limited to webhook messages.
operation:
  method: GET
  path: /_fake/messages
  server: http://127.0.0.1:8790
  auth: none
  parameters:
    - name: channel
      in: query
      required: true
      type: string
      example: '100000000000000020'
    - name: webhook
      in: query
      type: string
      description: Set to 1 to restrict results to webhook messages.
      example: '1'
  responses:
    '200':
      contentType: application/json
      description: Messages in oldest-first order, with full content.
    '400':
      description: The channel query is absent or the channel is unknown.
      example:
        error: message
source:
  - label: message reads
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L214
---
