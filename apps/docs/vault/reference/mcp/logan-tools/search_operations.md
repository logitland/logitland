---
title: search_operations
description: 'Finds operations the person might perform somewhere in the server.'
---

[Logan MCP tools](../logan-tools.md) · [MCP reference](../index.md)

Authenticate at `/mcp/admin` with a person's `lla_` token; see the [Logan tool overview](../logan-tools.md) for membership and permission requirements.

Finds operations the person might perform somewhere in the server.
Plain-language search and exact operation IDs both work.
Results sort by relevance, then operation ID.
An empty query lists matching available operations.

| Argument | Type and default                                             |
| -------- | ------------------------------------------------------------ |
| `query`  | Optional string, at most 200 characters                      |
| `method` | Optional `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`          |
| `family` | Optional string, at most 40 characters; exact family match   |
| `cursor` | Optional string, at most 10 characters; default offset `"0"` |

Common families include `channel`, `message`, `thread`, `member`, `role`, `guild`, and `moderation`.
Each page contains at most twenty operations.
Pass `next_cursor` as `cursor` to continue.
Omitted `next_cursor` means the last page.
The implementation parses the cursor as a numeric offset; use only values it returns.

```json
{ "name": "search_operations", "arguments": { "query": "delete_channel", "method": "DELETE", "family": "channel" } }
```

Example response for a caller whose permissions permit the search result:

```json
{
  "operations": [
    {
      "operation_id": "delete_channel",
      "method": "DELETE",
      "path": "/channels/{channel_id}",
      "family": "channel",
      "risk": "destructive",
      "needs_confirmation": true
    }
  ]
}
```

A result is not permission to execute against every target.
Search checks base grants across the server's known channels.
Execution checks the specific target, body-dependent requirements, and role hierarchy.
No matches return `{"operations":[]}`.
Invalid argument types or lengths become `invalid_request` tool errors.

Sources: [schema](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L16),
[search handler](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L71),
[catalog search](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/catalog.ts).
