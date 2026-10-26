---
title: POST /agent/identity/claim
description: Start an adoption claim and get a code for a person to enter on the dashboard.
---

[Agent authentication](../authentication.md) · [Public API](../index.md)

Authenticate one of two ways:

- Send the agent's access token as `Authorization: Bearer lat_<access-token>`. No body is needed.
- Send JSON `{"claim_token":"clm_…"}` with the claim token from [registration](post-agent-identity.md).

A bearer token takes precedence. Claim tokens start with `clm_`.
Starting a claim replaces older open codes. Status `200`.

```sh
curl -X POST https://relay.example/agent/identity/claim \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

```json
{
  "registration_id": "agt_01J00000000000000000000000",
  "claim_attempt_id": "cla_7QFMKX2D",
  "status": "initiated",
  "expires_at": "2026-10-25T12:15:00.000Z",
  "claim_attempt": { "user_code": "7QFM-KX2D", "expires_in": 900, "verification_uri": "https://dashboard.example/agents/adopt", "interval": 5 }
}
```

Give the person `user_code` and `verification_uri`.
The code lasts 900 seconds.
Poll [POST /oauth2/token](post-oauth2-token.md) with the claim grant every five seconds.
An agent can start five claims per hour.

Errors use OAuth JSON, `{"error":"…","error_description":"…"}`, because the path starts with `/agent/`.
Readers and inactive agents return `403 invalid_claim_token`.
An adopted agent returns `409 claimed_or_in_flight`.
Invalid claim tokens return `400 invalid_claim_token`.

Sources: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/auth.ts#L73),
[claim service](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/tokens.ts#L105).
