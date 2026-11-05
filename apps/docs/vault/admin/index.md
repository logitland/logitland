---
title: Admin API
description: Logan, the staff MCP server. Do Discord admin work from your own MCP client, within your own permissions.
order: 5
---

Logan is the relay's Discord bot. Staff can connect an MCP client to `https://relay.example/mcp/admin` to perform Discord
operations within their own permissions, checked on every request. Agent tokens don't work here.

## Connect

To use Logan, you must remain a member of the Logitland Discord server and hold the relay's `logan` admin permission.
Full admins hold it automatically; a full admin can also grant it to a Discord role in the admin dashboard.
Logan fetches your current membership and roles on every request and allows each person 60 MCP requests a minute.

The [admin dashboard's Logan page](https://relay.example/admin/logan) has the URL to copy, and a ready-made command:

```sh
claude mcp add --transport http logan https://relay.example/mcp/admin
```

In Claude Code, run `/mcp`, choose `logan`, and authenticate.
An MCP client with OAuth support finds Logan's [authorization server](oauth/index.md) by itself, registers, and opens
your browser. Sign in with Discord and choose **Allow**. The client then holds your own `lla_` access token, which lasts an
hour, and a refresh token that lasts 30 days.

Sources: [route authentication and limit](https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/logan.ts#L98),
[caller loading](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L70).

## Work with the four tools

Logan has four tools, not one per Discord operation. Find an operation, read what it takes, then run it:

| Step | Tool                                          | Task                                       |
| ---- | --------------------------------------------- | ------------------------------------------ |
| 1    | [`search_operations`](search_operations.md)   | Find candidate operations in plain words.  |
| 2    | [`describe_operation`](describe_operation.md) | Read one operation's parameters and body.  |
| 3    | [`call_operation`](call_operation.md)         | Run it. Give a `reason` for the audit log. |
| 4    | [`request_status`](request_status.md)         | Track a request that needs confirmation.   |

For transport details, see [`POST /mcp/admin`](post-mcp-admin.md) and [method rejections](method-rejection-mcp-admin.md).

Reads and ordinary writes run at once. Destructive ones, such as deletes, kicks, bans, timeouts, and bulk changes, answer
`pending`: confirm them on Logan's message in the staff alerts channel within ten minutes, then check `request_status`.
Do not repeat `call_operation` to poll a pending request. Destructive operations are refused if no staff alerts channel is configured.
Successful writes go in the audit log. When configured, the staff alerts channel announces them under your name;
a failed notice does not undo the action.

The protocol is the [agent server's](../mcp/index.md#protocol), and its server name is `logan`. Tool pages show each
call's `params` and the `structuredContent` it returns; each result also carries that JSON as text in `content[0].text`.

Source: [tool registrations](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L57).

## What Logan can do

Your Discord permissions decide each operation, including channel overwrites, timeouts, conditional body fields, and
role and member hierarchy. Full relay admin standing does not stand in for them. A private thread needs your
`ViewChannel` and `ManageThreads`. Logan treats a permission condition it doesn't know as required, and never runs an
operation whose grant it can't verify. Discord then still checks Logan's own bot permissions.

Logan offers an operation only when it takes bot authentication, targets a guild or channel, has a known permission rule,
and takes JSON if it has a body. Credential operations, `@me` paths, direct account access, and multipart-only
operations are left out.

The operations come from the published `@mia-cx/discord-catalog` package in
[`mia-cx/discord-mcp`](https://github.com/mia-cx/discord-mcp). What you see changes with your roles, the target, and the
catalog version, so search for an operation rather than assuming it exists.

Sources: [offered operations](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L133),
[target and conditional checks](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/access.ts#L203),
[catalog adapter](https://github.com/logitland/logitland/blob/main/packages/relay/src/services/logan/catalog.ts#L1).

## Tool errors

Logan checks tool arguments before it runs anything. A refused call is a tool result with `isError: true`, inside the
JSON-RPC `result`:

```json
{
  "content": [{ "type": "text", "text": "{\"error\":\"not_found\",\"detail\":\"No such request of yours.\"}" }],
  "structuredContent": { "error": "not_found", "detail": "No such request of yours." },
  "isError": true
}
```

Schema errors add `errors`, with field paths and messages. Authentication, origin, and rate failures come earlier, as
HTTP [API errors](../api/index.md#errors).

Source: [tool error conversion](https://github.com/logitland/logitland/blob/main/packages/relay/src/mcp/logan-tools.ts#L35).

## The admin dashboard is not this API

The admin dashboard's own requests (registry, levels, moderation queue, settings) go to `/internal/admin/*` routes. Those
are not on the internet: only the web app reaches them, through a private Worker binding, after checking your session.
[Architecture](../architecture/internal-api/administration/index.md) documents them for maintainers.
