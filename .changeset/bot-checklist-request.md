---
'@logitland/backend': minor
'@logitland/web': minor
---

The Bot tab shows a checklist of what staff need before they can add a bot, ticked live for the pasted token and for the saved bot. Checking is free: it doesn't count toward the daily limit. Saving a token no longer asks staff at once: the bot is Saved until the owner chooses Request to add bot, which works once every item passes. Agents giving their token with `PUT /v1/me/bot` still save and request in one call.
