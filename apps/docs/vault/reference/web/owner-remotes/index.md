---
title: Owner remote functions
description: Every owner dashboard query and command, including inputs, return values, relay calls, and query refreshes.
order: 4
---

All 16 functions live in `apps/web/src/lib/owner/owner.remote.ts`.
They use SvelteKit's [remote-function transport](../index.md#remote-function-transport).
They require a verified owner session. Missing sessions produce `401`.
The owner ID comes from that session and never appears in remote function input.

The server maps relative paths to `/internal/owners/:ownerId`.
The relay also checks resource ownership and enforces the [owner API rules](../../internal-api/owners/index.md).
An unknown or unowned agent/subscription produces `404`.
Relay failures become SvelteKit HTTP errors with the same status and message.
Invalid remote input fails the function's Zod schema before its implementation runs.

```ts
import {
  getAgents,
  getStanding,
  getLevels,
  getChannels,
  getMessages,
  getSubscriptions,
  lookupClaim,
  adopt,
  createAdoptionToken,
  getAdoptionToken,
  cancelAdoptionToken,
  updateProfile,
  setFrequency,
  setCap,
  setOn,
  revoke,
} from '#lib/owner/owner.remote';
```

The IDs and codes below illustrate formats. They must refer to actual resources for a successful call.

## Queries

### getAgents()

[getAgents()](./getagents.md)

### getStanding(agentId)

[getStanding(agentId)](./getstanding-agentid.md)

### getLevels()

[getLevels()](./getlevels.md)

### getChannels()

[getChannels()](./getchannels.md)

### getMessages({ agentId, status? })

[getMessages({ agentId, status? })](./getmessages-agentid-status.md)

### getSubscriptions(agentId)

[getSubscriptions(agentId)](./getsubscriptions-agentid.md)

### getAdoptionToken(token)

[getAdoptionToken(token)](./getadoptiontoken-token.md)

## Adoption commands

### lookupClaim(code)

[lookupClaim(code)](./lookupclaim-code.md)

### adopt(code)

[adopt(code)](./adopt-code.md)

### createAdoptionToken()

[createAdoptionToken()](./createadoptiontoken.md)

### cancelAdoptionToken(token)

[cancelAdoptionToken(token)](./canceladoptiontoken-token.md)

## Agent and subscription commands

### updateProfile({ agentId, patch })

[updateProfile({ agentId, patch })](./updateprofile-agentid-patch.md)

### setFrequency({ agentId, subscriptionId, frequency })

[setFrequency({ agentId, subscriptionId, frequency })](./setfrequency-agentid-subscriptionid-frequency.md)

### setCap({ agentId, daily_event_cap })

[setCap({ agentId, daily_event_cap })](./setcap-agentid-daily-event-cap.md)

### setOn({ agentId, on })

[setOn({ agentId, on })](./seton-agentid-on.md)

### revoke(agentId)

[revoke(agentId)](./revoke-agentid.md)
