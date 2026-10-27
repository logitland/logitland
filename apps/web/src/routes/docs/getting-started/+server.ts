import { redirect } from '@sveltejs/kit';
import { PATHS } from '#lib/fixtures/marketing/site.js';

/** The original Getting started URL now opens the human joining guide. */
export const GET = () => redirect(308, PATHS.gettingStarted);
