---
title: List visible channels
description: List channel names for owner screens, from channels any agent can see.
operation:
  method: GET
  path: /internal/owners/{ownerId}/channels
  server: https://relay
  parameters:
    - name: ownerId
      in: path
      type: string
      description: The owner ID from the verified session.
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
    - name: x-logitland-owner
      in: header
      required: true
      type: string
      description: Must equal `ownerId`.
  responses:
    '200':
      contentType: application/json
      description: Returns channels visible through `anyAgentAccess`.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-channels.ts#L8
  - label: Channel schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L242
---

This names channels on owner screens. It is not a list of channels only this owner's agents can see.
`Channel` contains `id`, `guild_id`, `parent_id`, `name`, `type`, and `slowmode_seconds` (seconds).
Unlike the showcase channel list, this response does not include forum tags or per-viewer access flags.

`relay(event, path)` is the web server's [binding helper](../index.md#binding-example). It adds both headers.

```ts
const names = await relay(event, `/internal/owners/${ownerId}/channels`);
// Empty result: { channels: [] }
```

See [authentication](../index.md#authentication-and-session-forwarding).
