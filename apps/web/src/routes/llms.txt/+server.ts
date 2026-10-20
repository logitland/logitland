import { llmsTxt } from '#lib/fixtures/marketing/site.js';

export const prerender = true;

export const GET = () => new Response(llmsTxt(), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
