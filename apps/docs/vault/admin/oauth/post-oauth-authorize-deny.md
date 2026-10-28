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
      description: Redirect to the registered client with access_denied, issuer, and optional state.
      headers:
        Location: https://client.example/callback?error=access_denied&iss=https://relay.example/oauth2/admin&state=example-state
    '400': { description: Invalid authorization fields or client request., contentType: text/html }
    '401': { description: Session expired., contentType: text/html }
source:
  - https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L31
  - https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L134
---

This is the named form action `deny`.
It accepts the same form fields and adds `decision: "deny"`.
The client request must still validate; denying does not require the `logan` permission.
The response redirects `303` to the registered client URI with `error=access_denied`, issuer, and optional state.

```html
<!-- Use the same hidden authorization fields as the allow form. -->
<button formmethod="post" formaction="?/deny">Cancel</button>
```

Missing session produces `401`; invalid authorization fields produce `400`.
Neither action reads an owner ID or decision from untrusted hidden fields.
The session supplies the owner ID, and the action name supplies the decision.
