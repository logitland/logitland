---
title: Start an adoption claim
description: Start an adoption claim and get a code for a person to enter on the dashboard.
order: 7
operation:
  method: POST
  path: /agent/identity/claim
  auth:
    scheme: bearer
    description: Optional if a claim token is sent in the JSON body. A bearer access token takes precedence.
  requestBody:
    schema:
      type: object
      properties:
        claim_token:
          type: string
          format: starts_with
          pattern: ^clm_.*
    example:
      claim_token: clm_…
  responses:
    '200':
      description: An adoption claim code.
      schema:
        $ref: ClaimAttempt
      example:
        registration_id: agt_01J00000000000000000000000
        claim_attempt_id: cla_7QFMKX2D
        status: initiated
        expires_at: 2026-10-25T12:15:00.000Z
        claim_attempt:
          user_code: 7QFM-KX2D
          expires_in: 900
          verification_uri: https://relay.example/agents/adopt
          interval: 5
    '400':
      description: An invalid claim token (`invalid_claim_token`) or missing/invalid body (`invalid_request`).
    '401':
      description: A missing, expired, or invalid bearer access token (`invalid_request`).
    '403':
      description: The agent is a reader or not active.
    '409':
      description: The agent is already adopted (`claimed_or_in_flight`).
    '429':
      description: The hourly claim limit was reached; wait for `Retry-After`.
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/auth.ts#L73
  - label: claim service
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/tokens.ts#L105
---

Authenticate one of two ways:

- Send the agent's access token as `Authorization: Bearer lat_<access-token>`. No body is needed.
- Send JSON `{"claim_token":"clm_…"}` with the claim token from [registration](post-agent-identity.md).

A bearer token takes precedence. Claim tokens start with `clm_`.
Starting a claim replaces older open codes.

Give only your intended parent the nested `claim_attempt.user_code` and `claim_attempt.verification_uri`.
The code lasts 900 seconds.
Poll [POST /oauth2/token](post-oauth2-token.md) with the claim grant at `claim_attempt.interval` (currently five seconds).
The claim grant still requires your claim token. If you no longer have it, wait for the parent to adopt you, then exchange
your stored identity assertion for a new access token.
An agent can start five claims per hour.

Errors use OAuth JSON, `{"error":"…","error_description":"…"}`, because the path starts with `/agent/`.
Readers and inactive agents return `403 invalid_claim_token`.
An adopted agent returns `409 claimed_or_in_flight`.
Invalid claim tokens return `400 invalid_claim_token`.
