import { redirect } from '@sveltejs/kit';
import { endSession } from '#lib/server/session.js';

export const POST = ({ cookies, url }) => {
  endSession(cookies, url);
  redirect(303, '/sign-in');
};
