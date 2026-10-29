---
title: Record Logan consent
description: Record the owner's allow or deny decision for a Logan MCP OAuth request and get the client redirect.
operation:
  method: POST
  path: /internal/owners/{ownerId}/logan/authorize
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
        response_type:
          type: string
        client_id:
          type: string
          maxLength: 64
        redirect_uri:
          type: string
          maxLength: 2048
        code_challenge:
          type: string
          maxLength: 128
        code_challenge_method:
          type: string
          maxLength: 16
        state:
          type: string
          maxLength: 1024
        scope:
          type: string
          maxLength: 256
        resource:
          type: string
          maxLength: 2048
        decision:
          type: string
          enum:
            - allow
            - deny
      required:
        - response_type
        - client_id
        - redirect_uri
        - code_challenge
        - code_challenge_method
        - decision
    example:
      response_type: code
      client_id: lgc_0000000001
      redirect_uri: https://client.example/callback
      code_challenge: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      code_challenge_method: S256
      state: example-state
      decision: deny
  responses:
    '200':
      contentType: application/json
      description: Returns the client redirect URL.
    '400':
      description: An invalid client, redirect, flow, challenge, or resource; returned as problem JSON.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header, or an allow decision without `logan` permission.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-logan.ts#L15
  - label: Authorization
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L134
  - label: Request checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L113
  - label: Request schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1469
---

The JSON body is a `LoganAuthorization` plus `decision: "allow" | "deny"`. The service revalidates the client request, then returns `{ redirect_to: string }`.

`allow` requires the owner's `logan` admin permission; without it the route returns `403`. The redirect carries a single-use authorization code, optional state, and issuer. `deny` needs no admin permission. Its redirect carries `error=access_denied`, optional state, and issuer.

```ts
const authorization = {
  response_type: 'code',
  client_id: 'lgc_0000000001',
  redirect_uri: 'https://client.example/callback',
  code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  code_challenge_method: 'S256',
  state: 'example-state',
};
const { redirect_to } = await relay(event, `/internal/owners/${ownerId}/logan/authorize`, {
  method: 'POST',
  body: { ...authorization, decision: 'deny' },
});
```

`relay(event, path, { method, body })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and serializes `body` as JSON. The client ID and challenge are fictitious; a real call needs a registered client. See [authentication](../index.md#authentication-and-session-forwarding).

This route reports errors as problem JSON, unlike the public `/oauth2/admin/*` endpoints. The browser's [allow](../../../admin/oauth/post-oauth-authorize-allow.md) and [deny](../../../admin/oauth/post-oauth-authorize-deny.md) form actions call it.
