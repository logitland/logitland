---
title: Read admin channels
description: Read mirrored channels, categories, and per-level access.
operation:
  method: GET
  path: /internal/admin/channels
  server: https://relay
  parameters:
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: The forwarded owner, who needs at least one admin permission.
  responses:
    '200':
      description: Channels and categories with per-level access.
      example:
        channels: []
        categories: []
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-channels.ts#L15
  - label: Channel schemas
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L961
---

Returns `{ channels: AdminChannel[], categories: AdminCategory[] }`.
Each channel extends `Channel` with `hidden`, `has_webhook`, `position`, and per-level `{ level, view, post }` access. Categories contain `id`, `name`, and `position`, ordered by position then ID.
The service calculates access from guild roles, configured agent roles, and channel overwrites. It does not change Discord permissions.
See [shared authentication, errors, and binding examples](../index.md).
