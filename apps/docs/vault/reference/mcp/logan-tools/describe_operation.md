---
title: describe_operation
description: "Returns one catalog operation's input metadata and permission requirements."
---

[Logan MCP tools](../logan-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp/admin` with a person's `lla_` token; see the [Logan tool overview](../logan-tools.md) for membership and permission requirements.

Returns one catalog operation's input metadata and permission requirements.
Required `operation_id` is a string of at most 100 characters.
Descriptions can include an operation the person cannot execute, with `offered` or `available_to_you` false.

```json
{ "name": "describe_operation", "arguments": { "operation_id": "delete_channel" } }
```

Example response excerpt for an eligible caller:

```json
{
  "operation_id": "delete_channel",
  "method": "DELETE",
  "path": "/channels/{channel_id}",
  "family": "channel",
  "risk": "destructive",
  "needs_confirmation": true,
  "path_params": ["channel_id"],
  "query_params": [],
  "required_query": [],
  "body": null,
  "offered": true,
  "available_to_you": true
}
```

The full result also contains `required_permissions`, the catalog's permission rule object.
It states base alternatives, conditional requirements, and hierarchy rules where applicable.
`body` is null when the operation accepts none.
Otherwise it contains `required` and `schema`, with a schema name or null.
It does not return a complete Discord JSON schema.
`path_params` lists required path names.
`query_params` lists accepted query names.
`required_query` identifies required query entries.
Consult the operation's Discord schema documentation for field-level body types.

`update_guild_member` also returns a `note` explaining timeout confirmation.
`needs_confirmation` reflects the catalog's destructive risk.
A non-null `communication_disabled_until` timeout still requires confirmation even when that flag is false.

Unknown operation IDs return a `not_found` tool error.
Sources: [schema](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L22),
[describe handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L86),
[permission checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts).
