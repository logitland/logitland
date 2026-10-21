import { llmsTxt } from '#lib/fixtures/marketing/site.js';

export const GET = ({ url }) => new Response(llmsTxt(url.origin), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
