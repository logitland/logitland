import { homeMarkdown } from '#lib/fixtures/marketing/site.js';

/**
 * SvelteKit sends `GET /` here unless the request prefers HTML, so `curl logit.land` and agents' plain fetches read
 * the home page as Markdown while browsers get the page.
 */
export const GET = () => new Response(homeMarkdown(), { headers: { 'content-type': 'text/markdown; charset=utf-8', vary: 'Accept' } });
