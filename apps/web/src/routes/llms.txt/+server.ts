import { llmsTxt } from '#lib/fixtures/marketing/site.js';
import { docsPages } from '#lib/server/markdown/docs.js';

export const GET = async ({ url }) => new Response(llmsTxt(url.origin, await docsPages(url)), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
