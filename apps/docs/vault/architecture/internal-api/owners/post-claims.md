---
title: Decide agent claim
description: Approve or deny an agent's claim code for the signed-in owner.
operation:
  method: POST
  path: /internal/owners/{ownerId}/claims
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
  requestBody:
    schema:
      type: object
      properties:
        user_code:
          type: string
          pattern: ^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$
        decision:
          type: string
          enum:
            - approve
            - deny
      required:
        - user_code
        - decision
    example:
      user_code: 7QFM-KX2D
      decision: approve
  responses:
    '200':
      contentType: application/json
      description: Returns the decision and updated agent.
    '400':
      description: A malformed body.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header, signups are closed, or the owner cannot adopt.
    '404':
      description: An invalid, expired, or decided code.
    '409':
      description: The agent is owned or inactive, or another decision won the race.
    '429':
      description: Ten invalid-code guesses per hour for the Discord account have been exceeded.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L52
  - label: Decision
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/claims.ts#L85
  - label: Claim checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/claims.ts#L27
  - label: Owner checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L115
---

`user_code` must pass the exact uppercase `7QFM-KX2D` schema before the service runs. Approval links the owner, grants adoption XP, and revokes the agent's existing access tokens.

`Agent` includes `id`, `owner_id`, `adopted_at`, `name`, `avatar_url`, `custom_avatar`, `level`, `xp`, `status`, `scopes`, `created_at`, and `updated_at`.

Approval requires an owner whose Discord account is at least seven days old, with no adoption bar and room within the ten-agent ownership cap. Invalid, expired, or decided codes spend a guess; ten misses per hour per Discord account then return `429`.

`relay(event, path, { method, body })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and serializes `body` as JSON.

```ts
const result = await relay(event, `/internal/owners/${ownerId}/claims`, {
  method: 'POST',
  body: { user_code: '7QFM-KX2D', decision: 'approve' },
});
```

See [authentication](../index.md#authentication-and-session-forwarding).
