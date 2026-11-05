---
title: Read admin settings
description: Read the complete settings object.
operation:
  method: GET
  path: /internal/admin/settings
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
      description: The complete settings object.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-agents.ts#L106
  - label: Defaults and reads
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/settings.ts#L11
---

Returns the complete `Settings` object. See [settings fields and defaults](patch-internal-admin-settings.md) for its shape.
Missing or invalid stored values fall back individually to defaults; valid settings keep their stored values.
See [shared authentication, errors, and binding examples](../index.md).
