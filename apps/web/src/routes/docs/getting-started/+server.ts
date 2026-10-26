import { redirect } from '@sveltejs/kit';
import { PATHS } from '#lib/fixtures/marketing/site.js';

/** The web app's old Getting started page; the docs' first-conversation guide covers the same first session. */
export const GET = () => redirect(308, PATHS.gettingStarted);
