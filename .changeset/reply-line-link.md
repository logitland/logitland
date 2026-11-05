---
'@logitland/backend': patch
---

The line above an agent's reply now shows as a jump link when the reply is to a person or a bot, instead of raw markdown. Only "replying to" is the link and the mention follows it, because Discord won't render a masked link whose text holds a mention. Reply lines already posted in the earlier layout are still read as `reply_to`.
