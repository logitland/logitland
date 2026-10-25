---
title: Fake Discord control diagnostics
description: Request logs, injected failures, resets, and rate limits for the local fake.
---

These [local control endpoints](control-seeding.md) have **no authentication**.
Success returns `200` JSON. Invalid inputs return `400 {"error":"message"}`.

## Requests and clearing

| Method and path          | Inputs and behavior                                                                                                                                                                                         | Success JSON                    | Concrete example                                       | Source                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `GET /_fake/requests`    | Optional query `route` selects a name or trailing-`*` prefix. `since` defaults to `0` and selects request numbers greater than that value. `limit` defaults to `500` and selects the last matching entries. | `{requests: RecordedRequest[]}` | `GET /_fake/requests?route=webhook.*&since=0&limit=20` | [request log](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L278)    |
| `DELETE /_fake/requests` | No body required. Clears only REST request records.                                                                                                                                                         | `{"ok":true}`                   | `DELETE /_fake/requests`                               | [clear requests](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L289) |
| `POST /_fake/clear`      | Optional `messages`, default `false`. Clears requests, Gateway frame log, failure rules, and rate buckets. `messages: true` also clears stored messages and threads.                                        | `{"ok":true}`                   | `POST /_fake/clear` with `{"messages":true}`.          | [clear](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L110)          |

A RecordedRequest contains `n`, `at`, `route`, `method`, `path`, `query`, `headers`, `body`, `status`, `reply`, `injected`, and `params`.
`path` excludes the API prefix and query. Header names are lowercase.
A dropped connection records `status: 0`; `injected` names the applied failure behavior or is `null`.
Unknown REST routes also enter the log. Control and OAuth handlers bypass it.
Clearing logs does not reset request numbers, OAuth tokens, interactions, guilds, or Gateway sessions.

Sources: [record fields](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L90),
[HTTP dispatcher](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L501),
[reset](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L405).

## Failure rules

| Method and path              | Inputs and behavior                                                                                                                                                   | Success JSON                                                                              | Concrete example                                                                                     | Source                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /_fake/failures`        | No inputs. Lists rules, including their match, behavior, remaining configuration, and hits.                                                                           | `{failures: [{id,match,behaviour,times,hits}]}`. Infinite `times` appears as `"forever"`. | `GET /_fake/failures`                                                                                | [list rules](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L300)  |
| `POST /_fake/failures`       | Required object `behaviour` with supported `type`. Optional object `match` defaults to matching everything. `times` defaults to `1`; accepts a number or `"forever"`. | `{id}`. Unsupported type returns `400`.                                                   | `{"match":{"route":"webhook.execute"},"behaviour":{"type":"rate_limit","retryAfter":1.5},"times":1}` | [add rule](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L302)    |
| `DELETE /_fake/failures`     | No inputs. Removes every rule.                                                                                                                                        | `{"ok":true}`                                                                             | `DELETE /_fake/failures`                                                                             | [clear rules](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L315) |
| `DELETE /_fake/failures/:id` | Digit-only rule ID. Removes that rule; an unknown ID also succeeds.                                                                                                   | `{"ok":true}`                                                                             | `DELETE /_fake/failures/1`                                                                           | [remove rule](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L315) |

Match fields are optional strings `route`, `method`, `path`, `channelId`, and `webhookId`.
`route` accepts an exact name or trailing-`*` prefix; `path` is exact and excludes the API prefix.
`method` compares case-insensitively. All supplied match fields must match.
For webhook requests, `channelId` refers to the webhook's channel, even when the request targets a thread.
The first matching unexhausted rule wins. Exhausted rules stay visible until removed.

| `behaviour.type` | Fields and result                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rate_limit`     | Optional `retryAfter` seconds (default `1`), `global` (default `false`), `scope` (`user`, `global`, or `shared`). Returns `429` without processing. Default scope follows `global`. |
| `status`         | Optional numeric `status` (default `500`) and arbitrary `body`. Returns them without processing. Default body is `{message,code:0}`.                                                |
| `slow`           | Required `ms`; `phase` defaults to `before`. `after` delays the response after processing.                                                                                          |
| `drop`           | `phase` defaults to `before`. Drops the socket without a response. `after` processes first.                                                                                         |

For example, simulate a write succeeding before its connection disappears:

```json
{
  "match": { "route": "webhook.execute" },
  "behaviour": { "type": "drop", "phase": "after" }
}
```

Source: [failure matching and application](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L419).

## Rate limits

`POST /_fake/rate-limits` accepts optional boolean `enforce`, plus `webhook` and `default` bucket patches.
Each bucket patch has optional numeric `limit` and `windowMs`.
It returns the full `{enforce,webhook,default}` configuration and clears existing bucket counts.
Omitted fields keep their current values.

```sh
curl http://127.0.0.1:8790/_fake/rate-limits \
  -H 'Content-Type: application/json' \
  -d '{"enforce":true,"webhook":{"limit":2,"windowMs":1000}}'
```

Defaults are `enforce: false`, `webhook: {limit:5,windowMs:2000}`, and `default: {limit:50,windowMs:1000}`.
The handler passes bucket patches through without range validation.
Webhook buckets are shared per webhook ID. Other buckets use the route's major parameter.
Enforced exhaustion returns REST `429` with `message`, `retry_after` seconds, and `global: false`.

Sources: [rate-limit endpoint](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/control.ts#L441),
[configuration defaults](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L149),
[bucket keys](https://github.com/logitland/logitland/blob/main/packages/discord-fake/src/fake.ts#L465).
