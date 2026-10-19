import { redirect } from '@sveltejs/kit';
import { clearSession } from '#lib/server/session.js';

export function POST({ cookies }) {
  clearSession(cookies);
  redirect(303, '/login?signed_out=1');
}
