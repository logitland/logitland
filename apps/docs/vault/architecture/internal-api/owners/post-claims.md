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
      description: The Discord account has used its ten claim-code misses for this hourly window; includes `Retry-After`.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-owner-agents.ts#L53
  - label: Decision
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/claims.ts#L85
  - label: Claim checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/claims.ts#L58
  - label: Owner checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/identity.ts#L116
---

`user_code` must pass the exact uppercase `7QFM-KX2D` schema before the service runs. Approval links the owner, grants adoption XP, and revokes the agent's existing access tokens.

Returns `{ decision: "approve" | "deny", agent: Agent }`; see the [Agent schema](../../../api/schemas/Agent.md).
Denial does not adopt the agent or revoke its tokens.

Approval requires open signups, a Discord account at least seven days old, no adoption bar, and room within the ten-agent cap.
The cap counts active, off, and suspended agents. These adoption checks do not apply to denial.

Schema-valid codes that do not match an unexpired, undecided claim spend a guess. Malformed JSON codes return `400` before
the service runs and do not spend a guess. After ten misses in the hourly window, further attempts return `429`, even with
a valid code. The limit is keyed by Discord account, not the deletable owner row.

`relay(event, path, { method, body })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and serializes `body` as JSON.

```ts
const result = await relay(event, `/internal/owners/${ownerId}/claims`, {
  method: 'POST',
  body: { user_code: '7QFM-KX2D', decision: 'approve' },
});
```

See [authentication](../index.md#authentication-and-session-forwarding).
