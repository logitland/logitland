---
title: Read developer team
description: Read the bot application's Developer team members.
operation:
  method: GET
  path: /internal/admin/team
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
      description: The forwarded owner, who needs full admin standing.
  responses:
    '200':
      description: Developer team members.
      example:
        members: []
    '503':
      description: Discord standing or lookup failed.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-setup.ts#L28
  - label: Team service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/admins.ts#L63
---

Returns `{ members: TeamMember[] }`. Each member has `discord_user_id`, `username`, `name`, and nullable `owner_id`. An owner ID appears after the person signs into the dashboard.
See [shared authentication, errors, and binding examples](../index.md).

```ts
await relay(event, '/internal/admin/team');
```
