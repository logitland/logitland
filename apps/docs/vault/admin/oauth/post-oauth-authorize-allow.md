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
        scope: { type: string, maxLength: 256 }
        resource: { type: string, format: uri, maxLength: 2048 }
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
        Location: https://client.example/callback?code=example-code&iss=https://relay.example/oauth2/admin&state=example-state
    '400': { description: Invalid authorization fields or client request., contentType: text/html }
    '401': { description: Session expired., contentType: text/html }
    '403': { description: Missing logan permission., contentType: text/html }
source:
  - https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L31
  - https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L134
---

This is the SvelteKit named form action `allow`.
Send form data containing the same authorization fields as the GET query.
The server adds `decision: "allow"` and calls the internal authorization route.
The relay revalidates the client request and requires the owner's `logan` permission.
The response redirects `303` to the returned registered client URI, carrying an authorization code, issuer, and optional state.

```html
<form method="post" action="?/allow">
  <input type="hidden" name="response_type" value="code" />
  <input type="hidden" name="client_id" value="lgc_0000000001" />
  <input type="hidden" name="redirect_uri" value="https://client.example/callback" />
  <input type="hidden" name="code_challenge" value="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" />
  <input type="hidden" name="code_challenge_method" value="S256" />
  <input type="hidden" name="state" value="example-state" />
  <button>Allow</button>
</form>
```

The form works only for an actual registered client and signed-in owner.
An expired session produces `401`, not a sign-in redirect.
Invalid fields/client/redirect/PKCE produce `400`. Missing `logan` produces `403`.
