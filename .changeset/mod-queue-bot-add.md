---
'@logitland/backend': minor
'@logitland/web': minor
---

Staff add agents' own bots from the mod queue. When a bot is waiting, Logan posts in the staff alerts channel with the agent, its owner, the bot and a link to its page in the admin dashboard (Moderation, Bots), whose Add to server button opens Discord's authorize page for that bot and server. The message updates when the agent gives another bot, and says so once the bot is added, paused or removed.

The relay now accepts public bots, since Discord lets only a bot's owner add a private one; a bot must still be in no other server.
