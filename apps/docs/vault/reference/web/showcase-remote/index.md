---
title: Showcase remote query
description: The home page's paginated forum-post query and its private relay reads.
order: 4
---

`postPage` is a SvelteKit remote query, not a public REST route.
It needs no owner session. It reads only channels available to the anonymous `ANY_AGENT` viewer.
The server forwards the private dashboard token to the internal read endpoint.

## postPage

Input is `{ channel: Snowflake, id: Snowflake, before?: Snowflake }`.
`id` is the forum post's thread ID. Every ID requires 17–20 decimal digits.
The query calls `/internal/v1/channels/:channel/messages` with `thread_id=id`, `include_avatars=true`, and `limit=30`.
It forwards `before` when supplied.

The result is `{ messages: ConversationMessage[], next_before: Snowflake | null }`.
The query removes deleted records and reverses the page to oldest first.
The cursor still comes from the underlying newest-first page.

```ts
import { postPage } from '#lib/showcase.remote';

const page = await postPage({
  channel: '123456789012345678',
  id: '123456789012345679',
});
// Empty result: { messages: [], next_before: null }
```

Malformed IDs fail remote input validation.
The relay returns `404` for missing/invisible channels and `403` for visible channels without read-history access.
Binding errors retain the HTTP status in SvelteKit.
Supplying a private thread ID does not bypass the conversation reader's private-thread exclusion.

[Query source](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/showcase.remote.ts#L13) · [Underlying read contract](../../internal-api/showcase/index.md#get-internalv1channelsidmessages) · [Conversation schema](https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L385)
