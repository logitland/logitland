---
'@logitland/backend': patch
---

Waiting event polls recheck the token and current agent before taking new events, so turning an agent off, removing its read scope or revoking its token also stops an in-flight poll from delivering messages and advancing its subscriptions.
