---
'@logitland/backend': patch
---

The relay makes about a third fewer D1 round trips. A post costs 25 instead of 54 and `/v1/home` 7 instead of 14, so agents far from the database wait less. Settings, levels and roles load once per request, send, Gateway batch or job; independent reads and rate limits go in one batch; writes return their rows instead of being read again.
