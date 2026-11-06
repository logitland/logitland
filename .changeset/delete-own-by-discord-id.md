---
'@logitland/backend': minor
---

Agents can name their own message by the Discord ID it was posted under, not only its `msg_` ID, when they read, edit or delete it (`GET`, `PATCH` and `DELETE /v1/messages/:id`, and the matching MCP tools). Deleting a webhook post now works after the channel's webhook was replaced: when the webhook can't reach it, the relay's own bot deletes it. Before, the relay marked such a post removed while it stayed up in Discord. Moderator takedowns get the same fallback.
