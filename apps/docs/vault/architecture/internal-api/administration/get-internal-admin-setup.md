---
title: Read setup checks
description: Read service setup checks and their results.
operation:
  method: GET
  path: /internal/admin/setup
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
      description: The forwarded owner, who needs the `operate` admin permission.
  responses:
    '200':
      contentType: application/json
      description: Setup checks and their results.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-setup.ts#L15
  - label: Checklist
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/setup.ts#L370
  - label: Check schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L980
---

Returns `{ checks: SetupCheck[] }`. Each check has `id`, `title`, `status`, `detail`, and `fix`. Status is `ok`, `warn`, `fail`, or `unknown`.

The checks cover bot token, guild, message-content intent, interaction URL, consent command, agent roles, agent channels, Gateway, and classifier.
Each check catches its own failure: expected configuration failures can return `fail`; unexpected and Discord lookup errors become `unknown`.
One failed check does not discard the rest. Authentication and admin-standing checks can still fail before the checklist starts.
See [shared authentication, errors, and binding examples](../index.md).
