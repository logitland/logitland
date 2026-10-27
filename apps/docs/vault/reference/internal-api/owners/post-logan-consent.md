---
title: Check Logan consent
description: Validate a Logan MCP OAuth request and report whether the owner may allow it.
operation:
  method: POST
  path: /internal/owners/{ownerId}/logan/consent
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
      required:
        - response_type
        - client_id
        - redirect_uri
        - code_challenge
        - code_challenge_method
    example:
      response_type: code
      client_id: lgc_0000000001
      redirect_uri: https://client.example/callback
      code_challenge: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      code_challenge_method: S256
      state: example-state
  responses:
    '200':
      contentType: application/json
      description: Returns the client name and whether the owner holds the `logan` admin permission.
    '400':
      description: An invalid client, redirect, flow, challenge, or resource; returned as problem JSON.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: A missing or different owner header.
source:
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-logan.ts#L11
  - label: Consent
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L128
  - label: Request checks
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L113
  - label: Request schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1386
---

The owner needs no admin permission for this call. The JSON body is a `LoganAuthorization`, copied from the browser's [consent page](../../web/endpoints/get-oauth-authorize.md) query. `client_id` must be registered; `redirect_uri` must match its registration; `resource`, when present, must name Logan's MCP. The `scope` field is not checked by this route. See [authentication](../index.md#authentication-and-session-forwarding).

`allowed` says whether this owner holds the `logan` admin permission. The client ID and challenge below are fictitious; a real call needs a registered client.

```ts
const authorization = {
  response_type: 'code',
  client_id: 'lgc_0000000001',
  redirect_uri: 'https://client.example/callback',
  code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  code_challenge_method: 'S256',
  state: 'example-state',
};
const consent = await relay(event, `/internal/owners/${ownerId}/logan/consent`, { method: 'POST', body: authorization });
```

`relay(event, path, { method, body })` is the web server's [binding helper](../index.md#binding-example). It adds both headers and serializes `body` as JSON.

This route reports errors as problem JSON, unlike the public `/oauth2/admin/*` endpoints.
