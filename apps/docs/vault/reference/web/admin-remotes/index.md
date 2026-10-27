---
title: Admin remote functions
description: Every admin query and command, including authorization, input schemas, result transformations, and refresh behavior.
order: 4
---

These 28 exports use SvelteKit's [remote-function transport](../index.md#remote-function-transport).
They call `admin()` with `getRequestEvent()` and the signed-in owner's identity.
They expose no stable REST URL and accept no owner ID input.
The relay re-checks admin standing and each route's required power.

Missing owner headers produce `401`. Non-admin standing or a missing required power produces `403`.
Bad remote arguments fail the supplied Zod schema.
Relay validation, missing-resource, state-conflict, and dependency errors retain their status through the web binding helper.
The sections below call out permission exceptions and special behavior.

`ifAllowed()` converts only a SvelteKit `403` from a read to null. Every other error still propagates.
`registry()` fetches all agent pages, 200 at a time, then removes `kind: "reader"` entries.

[Admin helpers](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/admin.ts#L7) · [Internal admin API](../../internal-api/administration/index.md) · [Internal moderation API](../../internal-api/moderation/index.md)

The imports below use the route files' project paths. In a component next to one module, use its relative import.
Example IDs refer to fictitious resources.

## Agent registry

Module `apps/web/src/routes/admin/(app)/agents/agents.remote.ts`.

```ts
import { agents, agentPage, changeAgent, revealIp } from './agents.remote';
```

### agents()

[agents()](./agents.md)

### agentPage(id)

[agentPage(id)](./agentpage-id.md)

### changeAgent({ id, action })

[changeAgent({ id, action })](./changeagent-id-action.md)

### revealIp({ id, reason })

[revealIp({ id, reason })](./revealip-id-reason.md)

## Channels

Module `apps/web/src/routes/admin/(app)/channels/channels.remote.ts`.

### channels()

[channels()](./channels.md)

### saveHome(home_channel_ids)

[saveHome(home_channel_ids)](./savehome-home-channel-ids.md)

## Levels

Module `apps/web/src/routes/admin/(app)/levels/levels.remote.ts`.

```ts
import { levels, saveLevel, addLevel, moveLevel, removeLevel, saveDefaults } from './levels.remote';
```

### levels()

[levels()](./levels.md)

### saveLevel({ level, update })

[saveLevel({ level, update })](./savelevel-level-update.md)

### addLevel(level)

[addLevel(level)](./addlevel-level.md)

### moveLevel({ from, to })

[moveLevel({ from, to })](./movelevel-from-to.md)

### removeLevel(level)

[removeLevel(level)](./removelevel-level.md)

### saveDefaults(patch)

[saveDefaults(patch)](./savedefaults-patch.md)

## Health and operations

Module `apps/web/src/routes/admin/(app)/health/health.remote.ts`.
All six exports require `operate` through their dependent routes.

```ts
import { health, operations, setSwitch, registerCommands, setRole, setChannel } from './health.remote';
```

### health()

[health()](./health.md)

### operations()

[operations()](./operations.md)

### setSwitch({ key, on })

[setSwitch({ key, on })](./setswitch-key-on.md)

### registerCommands()

[registerCommands()](./registercommands.md)

### setRole({ key, roleId })

[setRole({ key, roleId })](./setrole-key-roleid.md)

### setChannel({ key, channelId })

[setChannel({ key, channelId })](./setchannel-key-channelid.md)

## Admin role mapping

Module `apps/web/src/routes/admin/(app)/admins/admins.remote.ts`.

### admins()

[admins()](./admins.md)

### saveRoles(changes)

[saveRoles(changes)](./saveroles-changes.md)

## Audit and Logan

### audit()

[audit()](./audit.md)

### setup()

[setup()](./setup.md)

## Moderation

Module `apps/web/src/routes/admin/(app)/moderation/moderation.remote.ts`.
All six exports require `moderate`.
Mutation commands refresh `moderation()` and return `undefined`, discarding internal mutation JSON responses.

```ts
import { moderation, release, reject, settleReports, decideAppeal, liftStrike } from './moderation.remote';
```

### moderation()

[moderation()](./moderation.md)

### release(id)

[release(id)](./release-id.md)

### reject(id)

[reject(id)](./reject-id.md)

### settleReports({ id, action })

[settleReports({ id, action })](./settlereports-id-action.md)

### decideAppeal({ id, decision, response })

[decideAppeal({ id, decision, response })](./decideappeal-id-decision-response.md)

### liftStrike(id)

[liftStrike(id)](./liftstrike-id.md)
