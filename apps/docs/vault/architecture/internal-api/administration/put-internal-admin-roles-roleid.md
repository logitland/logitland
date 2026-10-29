---
title: Set role permissions
description: Set the admin permissions mapped to a server role.
operation:
  method: PUT
  path: /internal/admin/roles/{roleId}
  server: https://relay
  parameters:
    - name: roleId
      in: path
      required: true
      type: string
      example: '123456789012345678'
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
  requestBody:
    schema:
      type: object
      properties:
        permissions:
          maxItems: 5
          type: array
          items:
            type: string
            enum:
              - moderate
              - agents
              - levels
              - operate
              - logan
      required:
        - permissions
    example:
      permissions:
        - moderate
        - agents
  responses:
    '200':
      contentType: application/json
      description: The updated role and permission mapping.
    '400':
      description: The body is invalid or the role is `@everyone`.
    '404':
      description: The server role does not exist.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-admin-setup.ts#L21
  - label: Write service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/admins.ts#L123
  - label: Schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1448
---

The service deduplicates and orders the permissions. An empty list removes the role's admin mapping. The response is the bare `{ id, name, permissions }` role. The change is audited.
See [shared authentication, errors, and binding examples](../index.md).
