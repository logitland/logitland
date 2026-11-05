---
title: Register consent commands
description: Replace this application's guild commands with the relay's consent command.
operation:
  method: POST
  path: /internal/admin/discord/commands
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
      description: Registered commands with their Discord-assigned IDs.
    '422':
      description: Discord refused the registration (`invalid_request`).
    '502':
      description: Another Discord failure, including a rate limit (`internal`).
    '503':
      description: Application or guild configuration is missing (`misconfigured`).
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-setup.ts#L18
  - label: Registration service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/setup.ts#L411
  - label: Discord error mapping
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/setup.ts#L25
---

Registration is audited. The response is `{ commands: [{ id, name, subcommands: string[] }] }`. The consent command contains the `agree`, `withdraw`, and `status` subcommands.
See [shared authentication, errors, and binding examples](../index.md).
