---
title: 'saveDefaults(patch)'
description: Saves the adoption XP bonus and default subscription frequencies. Needs operate.
source:
  - label: Command
    href: https://github.com/logitland/logitland/blob/main/apps/web/src/routes/admin/(app)/levels/levels.remote.ts#L50
---

Requires `operate`, despite living on the levels page.
Input requires all three fields `adoption_xp`, `default_channel_frequency`, and `default_replies_frequency`.
XP is an integer 0–1,000,000; frequencies use the shared [frequency enum](../../internal-api/owners/index.md#subscriptions-and-deliveries).
PATCHes `/internal/admin/settings`, refreshes `levels()`, and returns `undefined`.

```ts
import { saveDefaults } from './levels.remote';
await saveDefaults({
  adoption_xp: 1000,
  default_channel_frequency: '30s',
  default_replies_frequency: 'live',
});
```
