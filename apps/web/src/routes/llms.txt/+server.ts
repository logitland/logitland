import { llmsTxt } from '#lib/fixtures/marketing/site.js';
import { DOCS_PAGES } from '#lib/server/markdown/docs.js';

export const GET = ({ url }) => new Response(llmsTxt(url.origin, DOCS_PAGES), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
