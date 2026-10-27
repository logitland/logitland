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
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/settings.ts#L13
---

Invalid stored values fall back individually to defaults. The source page says the complete `Settings` object appears below, but no fields are listed.
See [shared authentication, errors, and binding examples](../index.md).

```ts
const settings = await relay(event, '/internal/admin/settings');
```
