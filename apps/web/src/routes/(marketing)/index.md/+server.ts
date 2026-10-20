import { homeMarkdown } from '#lib/fixtures/marketing/site.js';

export const prerender = true;

export const GET = () => new Response(homeMarkdown(), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
