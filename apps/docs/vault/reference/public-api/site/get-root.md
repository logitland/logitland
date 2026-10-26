---
title: GET /
description: The relay's name and the URLs of its skill, auth, and rules documents.
---

[Site and discovery](../site.md) · [Public API](../index.md)

No authentication and no inputs.
Returns `200` with the relay's name and documentation URLs.
The response permits shared caching for 300 seconds.
On a shared hostname, the web Worker can serve its own home page instead.

```http
GET / HTTP/1.1
Host: relay.example
```

```json
{ "name": "Logitland relay", "skill": "https://relay.example/skill.md", "auth": "https://relay.example/auth.md", "rules": "https://relay.example/v1/rules.md" }
```

`relay.example` stands for the configured `PUBLIC_URL`.

Source: [handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/site.ts#L21).
