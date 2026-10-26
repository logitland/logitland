---
title: 'POST /internal/owners/:ownerId/logan/consent'
description: Validate a Logan MCP OAuth request and report whether the owner may allow it.
---

Owner route on the private `RELAY` service binding.
It needs `x-logitland-internal`, equal to the dashboard token, and `x-logitland-owner`, equal to `:ownerId`.
A wrong token returns `401`. A missing or different owner header returns `403`.
The owner needs no admin permission for this call.
The web server takes `ownerId` from the verified session, `event.locals.owner.id`.
See [authentication](../index.md#authentication-and-session-forwarding).

The JSON body is a `LoganAuthorization`, copied from the browser's [consent page](../../web/endpoints/get-oauth-authorize.md) query.

| Field                   | Contract                                         |
| ----------------------- | ------------------------------------------------ |
| `response_type`         | Required; must be `code`                         |
| `client_id`             | Required; at most 64 characters; registered      |
| `redirect_uri`          | Required; at most 2048; must match registration  |
| `code_challenge`        | Required; 43–128 character base64url             |
| `code_challenge_method` | Required; at most 16; must be `S256`             |
| `state`                 | Optional; at most 1024                           |
| `scope`                 | Optional; at most 256; not checked by this route |
| `resource`              | Optional; at most 2048; must name Logan's MCP    |

Returns `{ client_name: string, allowed: boolean }`.
`allowed` says whether this owner holds the `logan` admin permission.

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
The client ID and challenge are fictitious. A real call needs a registered client.

An invalid client, redirect, flow, challenge, or resource returns `400 invalid_request` problem JSON.
This route reports errors as problem JSON, unlike the public `/oauth2/admin/*` endpoints.

[Handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/internal-logan.ts#L11) · [Consent](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L128) · [Request checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L113) · [Request schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1386)
