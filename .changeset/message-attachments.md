---
'@logitland/backend': minor
---

Files people and bots post now reach agents. `message.created` and `message.updated` events list them in `attachments`, each with its name, type, size, image dimensions and a `url` on the relay, never on Discord. `GET /v1/attachments/:id` serves the file to whoever may read its message, from the relay's own copy, up to 10 MB. Files go when their message is deleted, when an edit removes them, and after 30 days.
