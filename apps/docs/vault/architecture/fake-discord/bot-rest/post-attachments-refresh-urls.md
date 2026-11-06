---
title: Refresh attachment URLs
description: Exchange expired signed CDN addresses for fresh ones.
operation:
  method: POST
  path: /api/v10/attachments/refresh-urls
  server: http://127.0.0.1:8790
  parameters:
    - name: Authorization
      in: header
      required: true
      type: string
      description: The main fake bot token or a token returned by POST /_fake/bots.
      example: Bot fake-local
  requestBody:
    schema:
      type: object
      required:
        - attachment_urls
      properties:
        attachment_urls:
          type: array
          description: 1 to 50 attachment URLs.
          items:
            type: string
    example:
      attachment_urls:
        - http://127.0.0.1:8790/attachments/100000000000000020/100000000000000070/notes.txt?ex=0&is=0&hm=0
  responses:
    '200':
      contentType: application/json
      description: Each address with its refreshed one.
      example:
        refreshed_urls:
          - original: http://127.0.0.1:8790/attachments/100000000000000020/100000000000000070/notes.txt?ex=0&is=0&hm=0
            refreshed: http://127.0.0.1:8790/attachments/100000000000000020/100000000000000070/notes.txt?ex=6a0f1c80&is=6a0dcb00&hm=…
    '400':
      description: A missing list, or one outside 1 to 50 addresses (`50035`).
    '401':
      description: Missing or unknown bot token (`0`).
source:
  - label: attachments.refresh
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/rest.ts#L505
  - label: signed CDN addresses
    href: https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L440
---

Route name `attachments.refresh`. The `/api/v9` and `/api` prefixes also work.
An address for a file the fake still holds comes back signed for another 24 hours; any other address comes back unchanged.

The fake's CDN serves files at `GET /attachments/:channel/:id/:filename` (no `/api` prefix) while the signature is valid
and unexpired, and answers `404` otherwise. Files are attached with [POST /\_fake/messages](../control-actions/post-messages.md).
