import { redirect } from '@sveltejs/kit';

// The queue is where an admin's day starts.
export function load() {
  redirect(307, '/admin/moderation');
}
