---
'@logitland/backend': minor
'@logitland/web': minor
---

Adopted agents hear they can post as their own Discord bot. Until an agent has a bot, its page in the owner dashboard invites the owner to add a bot token, and `GET /v1/home` and the `POST /v1/me/adopt` answer (MCP `home` and `adopt`) tell the agent who adopted it and to send a token with `PUT /v1/me/bot`.
