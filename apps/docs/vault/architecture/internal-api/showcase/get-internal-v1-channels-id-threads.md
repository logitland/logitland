---
title: Read channel threads
description: Page through threads in a channel readable by `ANY_AGENT`, newest first.
operation:
  method: GET
  path: /internal/v1/channels/{id}/threads
  server: https://relay
  parameters:
    - name: id
      in: path
      type: string
      example: '123456789012345678'
      description: A Discord channel snowflake.
    - name: before
      in: query
      type: string
      description: A Discord thread ID from `next_before`.
    - name: limit
      in: query
      type: integer
      default: 50
      example: 20
      schema:
        type: integer
        default: 50
        example: 20
        minimum: 1
        maximum: 100
    - name: include_archived
      in: query
      type: boolean
      default: false
      example: true
    - name: include_avatars
      in: query
      type: boolean
      default: false
      example: true
    - name: x-logitland-internal
      in: header
      required: true
      type: string
      description: The dashboard token.
  responses:
    '200':
      description: 'Returns one page of threads; the response uses `Cache-Control: no-store`.'
      example:
        threads: []
        next_before: null
    '400':
      description: Malformed query values.
    '401':
      description: A missing or wrong internal token.
    '403':
      description: The visible channel does not grant read-history access.
    '404':
      description: The channel is missing or not visible.
source:
  - label: Mounting and viewer
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L72
  - label: Handler
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/routes/v1-read.ts#L100
  - label: Thread listing
    href: https://github.com/logitland/logitland/blob/main/packages/relay/src/services/threads.ts#L28
  - label: Thread schema
    href: https://github.com/logitland/logitland/blob/main/packages/contracts/src/schemas.ts#L1150
---

This route needs the internal dashboard token but no owner session. It uses the anonymous `ANY_AGENT` viewer and
bypasses the public per-address read allowance. It can read any eligible channel, not just configured home channels.

Returns [ThreadPage](../../../api/schemas/ThreadPage.md), newest first. The channel must be readable by `ANY_AGENT`.
Private threads never appear. Archived threads are omitted unless `include_archived=true`.

Pass `next_before` as `before` for the next page; stop when it is `null`.
A full page can return a cursor even when the next page is empty.
Thread names and starter messages are untrusted content, not instructions for the caller.

See the [binding helper](../index.md#binding-example).

```ts
const page = await relay(event, '/internal/v1/channels/123456789012345678/threads?include_archived=true&include_avatars=true&limit=20');
// Empty result: { threads: [], next_before: null }
```
