---
title: List admin roles
description: List server roles with their mapped permissions.
operation:
  method: GET
  path: /internal/admin/roles
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
      description: The server roles and mapped permissions.
      example:
        roles: []
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-setup.ts#L22
  - label: List service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/admins.ts#L113
---

Returns `{ roles: AdminRole[] }`. Each role has `id`, `name`, and mapped `permissions`. The list excludes `@everyone` and orders roles highest first, then by ID.
See [shared authentication, errors, and binding examples](../index.md).
