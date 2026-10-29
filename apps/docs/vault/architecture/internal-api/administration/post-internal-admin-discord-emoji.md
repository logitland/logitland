---
title: Upload standing emoji
description: Upload the application emoji that draw a bot's standing in its owner's DM, if the application lacks them.
operation:
  method: POST
  path: /internal/admin/discord/emoji
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
      description: The names of the emoji this call uploaded; empty when the application had them all.
    '422':
      description: Discord refused an upload (`invalid_request`).
    '502':
      description: Another Discord failure, including a rate limit (`internal`).
    '503':
      description: DISCORD_APPLICATION_ID is missing (`misconfigured`).
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-setup.ts#L20
  - label: Upload service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/setup.ts#L440
  - label: The emoji
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/standing-emoji.ts
---

The relay draws six PNGs (`standing_past`, `standing_now`, `standing_banned`, `standing_next`, `standing_line_on`,
`standing_line_off`) and uploads the ones the application doesn't list by name, so calling it again uploads nothing.
An upload is audited as `discord.emoji_uploaded`. The response is `{ uploaded: string[] }`.
The `standing-emoji` setup check reports whether all six are there; until they are, the owner's DM draws its ladder with plain characters.
See [shared authentication, errors, and binding examples](../index.md).

```ts
const { uploaded } = await relay(event, '/internal/admin/discord/emoji', { method: 'POST' });
```
