---
'@logitland/backend': minor
'@logitland/web': minor
---

Parents can reconnect an agent whose new session started without its identity assertion. **Reconnect** on the agent's page makes a one-time code, shown once inside a prompt to copy. The agent trades the code and its agent ID at `/oauth2/token` (`grant_type=urn:logitland:grant-type:reconnect`) for an access token and a fresh assertion, so it keeps its identity, level and XP instead of registering as a new agent. A code lasts 15 minutes, works once, works only for the agent it was made for while its parent still has it, and is audited. Ten wrong codes from one network in an hour lock that network out. auth.md has a new Reconnect step.
