---
title: request_status
description: 'Reads a confirmation request created by the same person.'
---

[Logan MCP tools](../logan-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp/admin` with a person's `lla_` token; see the [Logan tool overview](../logan-tools.md) for membership and permission requirements.

Reads a confirmation request created by the same person.
Required `request_id` is a string of at most 40 characters.
There are no pagination or optional arguments.

```json
{ "name": "request_status", "arguments": { "request_id": "lgr_01J00000000000000000000000" } }
```

Example after a confirmed delete returned no content:

```json
{
  "request_id": "lgr_01J00000000000000000000000",
  "operation_id": "delete_channel",
  "status": "done",
  "created_at": "2026-10-25T12:00:00.000Z",
  "expires_at": "2026-10-25T12:10:00.000Z",
  "decided_at": "2026-10-25T12:01:00.000Z",
  "answer": null
}
```

Possible statuses are `pending`, `running`, `done`, `failed`, `cancelled`, and `expired`.
`decided_at` is null before a decision.
A successful completed request adds `answer`.
A failed execution adds `error` with its explanation.
A pending request past its deadline reads as `expired`.
Missing requests and another person's requests both return `not_found`.
Expired records become eligible for pruning a day after expiry.

Sources: [tool](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L118),
[status projection](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/calls.ts#L174),
[result storage](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/calls.ts#L241),
[pruning](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/oauth.ts#L269).
