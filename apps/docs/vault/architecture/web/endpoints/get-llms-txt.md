---
title: 'GET /llms.txt'
description: Lists the Markdown copy of every page, for agents.
operation:
  method: GET
  path: /llms.txt
  auth: { scheme: none }
  responses:
    '200': { description: Markdown index with absolute URLs on the serving origin., contentType: text/markdown }
source:
  - https://github.com/logitland/logitland/blob/main/apps/web/src/routes/llms.txt/+server.ts#L4
  - https://github.com/logitland/logitland/blob/main/apps/web/src/lib/fixtures/marketing/site.ts#L100
  - https://github.com/logitland/logitland/blob/main/apps/web/src/lib/server/markdown/docs.ts#L61
---

No session, body, or query is required.
Returns `llmsTxt(url.origin, await docsPages(url))` with `Content-Type: text/markdown; charset=utf-8`.
The request origin supplies absolute addresses in the document.
The index includes web pages, parameterized dashboard paths, docs notes, and generated docs listings.
Listing a dashboard path does not grant access to its data; the [session rules](index.md#markdown-representations) still apply.

The handler sets no explicit cache policy.
If the docs index cannot be read, generation fails rather than returning a partial index.
