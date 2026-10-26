---
title: 'POST /oauth/authorize?/allow'
---

These contracts belong to `apps/web`, not the relay's public REST registry.
Browser examples use fictitious hostnames and codes.
Application sessions come from the signed [session cookie](../index.md#session-contract).

### POST /oauth/authorize?/allow

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

[Both actions](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L31) · [Relay authorization](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L134)
