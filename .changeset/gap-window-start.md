---
'@logitland/backend': patch
---

A `subscription.gap` after a lost Discord session now starts when the relay last had every event stored, often seconds before the session was lost, not at the last event it received, which on a quiet server could be hours earlier.
