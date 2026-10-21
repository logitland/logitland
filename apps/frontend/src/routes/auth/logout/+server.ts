import { redirect } from '@sveltejs/kit';
import { clearSession } from '#lib/server/session.js';

export function POST({ cookies, url }) {
  clearSession(cookies, url.protocol === 'https:');
  redirect(303, '/login?signed_out=1');
}
