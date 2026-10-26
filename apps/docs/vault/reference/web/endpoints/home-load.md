---
title: 'Home /'
---

## Home /

Reads internal showcase stats and eligible channels. Loads 30 latest messages per text channel, or 20 archived-inclusive forum/media posts, with avatars. Returns `{ channels: HomeChannel[] \

null, at: number }`. Text messages exclude deleted records and reverse to oldest first. A showcase failure logs and returns `channels: null`. Example browser request `GET /`.

[Home load](<https://github.com/logitland/logitland/blob/main/apps/web/src/routes/(marketing)
