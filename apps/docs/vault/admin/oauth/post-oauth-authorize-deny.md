---
title: 'POST /oauth/authorize?/deny'
description: The consent form's Cancel action. Redirects back to the client with access_denied.
order: 6
operation:
  method: POST
  path: /oauth/authorize?/deny
  client: browser
  parameters:
    - { name: session, in: cookie, required: true, example: <browser-session> }
  requestBody:
    contentType: application/x-www-form-urlencoded
    schema:
      type: object
      required: [response_type, client_id, redirect_uri, code_challenge, code_challenge_method]
      properties:
        response_type: { type: string, const: code }
        client_id: { type: string, minLength: 1, maxLength: 64 }
        redirect_uri: { type: string, format: uri, maxLength: 2048 }
        code_challenge: { type: string, minLength: 43, maxLength: 128, pattern: '^[A-Za-z0-9_-]{43,128}$' }
        code_challenge_method: { type: string, const: S256 }
        state: { type: string, maxLength: 1024 }
        scope: { type: string, maxLength: 256, description: Accepted but not used to select scopes. }
        resource: { type: string, format: uri, maxLength: 2048, description: Must equal the Logan MCP URL, allowing one trailing slash. }
    example:
      response_type: code
      client_id: lgc_0000000001
      redirect_uri: https://client.example/callback
      code_challenge: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      code_challenge_method: S256
      state: example-state
  responses:
    '303':
      description: Redirect to the registered client with access_denied, issuer, and optional state.
      headers:
        Location: https://client.example/callback?state=example-state&iss=https%3A%2F%2Frelay.example%2Foauth2%2Fadmin&error=access_denied
    '400': { description: Invalid authorization fields or client request., contentType: text/html }
    '401': { description: Session expired., contentType: text/html }
source:
  - https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L31
  - https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L134
---

The SvelteKit named action `deny` cancels Logan consent. Submit the authorization fields from the
[consent page](get-oauth-authorize.md) as form data, using the actual registered client and PKCE challenge, not the example placeholders.
The session supplies the owner ID; the server adds `decision: "deny"`. Neither comes from untrusted form fields.

The client request must still validate, but denying does not require the `logan` permission.
Success redirects `303` to the validated client URI with `error=access_denied`, issuer, and optional state. No code is issued.

- A missing or expired session produces `401`. Start again from the MCP client.
- Invalid fields, client, redirect, PKCE challenge, or resource produce `400`, without redirecting to an unverified client URI.
