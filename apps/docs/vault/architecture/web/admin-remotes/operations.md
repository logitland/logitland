---
title: 'operations()'
description: The consent-command check, channel settings, and role settings for the health page. Needs operate.
source:
  - label: Query
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/health/health.remote.ts#L15
---

Requires `operate`. No input. Reads setup checks, settings, admin channels, and server roles concurrently.
Returns `{ commands, channelIds, channels, roleIds, roles }`.

| Field        | Contents                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------ |
| `commands`   | The setup check whose ID is `consent-command`, or null. Not the full checklist.            |
| `channelIds` | Configured `alerts_channel_id` and `talk_channel_id`, each an ID or null.                  |
| `channels`   | Nonhidden channel options as `{ id, name }`.                                               |
| `roleIds`    | Configured `agents_role_id`, `parents_role_id`, and `consent_role_id`, each an ID or null. |
| `roles`      | Server role options as `{ id, name }`, excluding `@everyone`.                              |

```ts
import { operations } from './health.remote';
const options = await operations();
console.log(options.commands?.status);
```
