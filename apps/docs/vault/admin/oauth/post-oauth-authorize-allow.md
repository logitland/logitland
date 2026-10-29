---
title: 'POST /oauth/authorize?/allow'
description: The consent form's Allow action. Issues a code and redirects back to the client.
order: 5
operation:
  method: POST
  path: /oauth/authorize?/allow
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
        scope: { type: string, maxLength: 256, description: Accepted but not used to select scopes. Tokens always carry logan. }
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
      description: Redirect to the registered client with an authorization code, issuer, and optional state.
      headers:
        Location: https://client.example/callback?state=example-state&iss=https%3A%2F%2Frelay.example%2Foauth2%2Fadmin&code=llc_example
    '400': { description: Invalid authorization fields or client request., contentType: text/html }
    '401': { description: Session expired., contentType: text/html }
    '403': { description: Missing logan permission., contentType: text/html }
source:
  - https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L31
  - https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L134
---

The SvelteKit named action `allow` submits Logan consent. Send the authorization fields from the
[consent page](get-oauth-authorize.md) as form data, using the actual registered client and PKCE challenge, not the example placeholders.
The session supplies the owner ID; the server adds `decision: "allow"`. Neither comes from untrusted form fields.

The relay revalidates the request and requires the owner's `logan` permission. Success redirects `303` to the validated
client URI with a single-use authorization code, issuer, and optional state. The code expires after five minutes;
the client [exchanges it with its PKCE verifier](post-oauth2-admin-token.md).

- An expired session produces `401`, not a sign-in redirect. Start again from the MCP client.
- Invalid fields, client, redirect, PKCE challenge, or resource produce `400`, without redirecting to an unverified client URI.
- Missing `logan` permission produces `403`.
