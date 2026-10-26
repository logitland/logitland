---
title: 'POST /oauth/authorize?/deny'
---

These contracts belong to `apps/web`, not the relay's public REST registry.
Browser examples use fictitious hostnames and codes.
Application sessions come from the signed [session cookie](../index.md#session-contract).

### POST /oauth/authorize?/deny

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

[Both actions](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L31) · [Relay authorization](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L134)

[Both actions](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/oauth/authorize/+page.server.ts#L31) · [Relay authorization](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L134)
