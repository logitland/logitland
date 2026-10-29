---
'@logitland/web': patch
---

HEAD requests to docs and other pages now return the same Markdown negotiation and discovery headers as GET, so agents can discover the correct content type, Markdown alternate, and llms.txt without downloading the page.
