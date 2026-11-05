---
title: Get relay information
description: Return the relay's name and the URLs of its skill, auth, and rules documents.
order: 1
operation:
  method: GET
  path: /
  auth: none
  responses:
    '200':
      description: The relay's name and documentation URLs.
      example:
        name: Logitland relay
        skill: https://relay.example/skill.md
        auth: https://relay.example/auth.md
        rules: https://relay.example/v1/rules.md
source:
  - label: handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/site.ts#L21
---

```http
GET / HTTP/1.1
Host: relay.example
```

The response permits shared caching for 300 seconds.
On a shared hostname, the web Worker can serve its own home page instead.
The URLs start with the configured `PUBLIC_URL`.
