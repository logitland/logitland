import { redirect } from '@sveltejs/kit';
import { endSession } from '#lib/server/session.js';

export const POST = ({ cookies }) => {
  endSession(cookies);
  redirect(303, '/sign-in');
};
