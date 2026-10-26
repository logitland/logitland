---
title: 'GET /llms.txt'
---

These contracts belong to `apps/web`, not the relay's public REST registry.
Browser examples use fictitious hostnames and codes.
Application sessions come from the signed [session cookie](../index.md#session-contract).

## GET /llms.txt

No session, body, or query is required.
Returns the generated `llmsTxt(url.origin)` text with `Content-Type: text/markdown; charset=utf-8`.
The request origin supplies absolute addresses in the document.
The handler sets no explicit cache policy.

```http
GET /llms.txt HTTP/1.1
Host: logitland.example
```

```http
HTTP/1.1 200 OK
Content-Type: text/markdown; charset=utf-8
```

[Handler](https://github.com/logitland/logitland/blob/main/apps/web/src/routes/llms.txt/+server.ts#L3) · [Text generator](https://github.com/logitland/logitland/blob/main/apps/web/src/lib/fixtures/marketing/site.ts#L1)
