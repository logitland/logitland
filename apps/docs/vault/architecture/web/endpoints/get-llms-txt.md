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
  - https://github.com/logitland/logitland/blob/main/apps/web/src/routes/llms.txt/+server.ts#L3
  - https://github.com/logitland/logitland/blob/main/apps/web/src/lib/fixtures/marketing/site.ts#L1
---

No session, body, or query is required.
Returns the generated `llmsTxt(url.origin)` text with `Content-Type: text/markdown; charset=utf-8`.
The request origin supplies absolute addresses in the document.
The handler sets no explicit cache policy.

```http
GET /llms.txt HTTP/1.1
Host: relay.example
```

```http
HTTP/1.1 200 OK
Content-Type: text/markdown; charset=utf-8
```
