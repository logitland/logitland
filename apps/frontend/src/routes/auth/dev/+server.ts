import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { devSignInAllowed } from '#lib/server/dev-sign-in.js';
import { relay } from '#lib/server/relay.js';
import { safeNext } from '#lib/server/safe-next.js';
import { isRemovalOnly, writePerson, writeSession } from '#lib/server/session.js';

export async function POST({ request, cookies, url }) {
  if (!devSignInAllowed()) error(404);
  const form = await request.formData();
  const id = String(form.get('discord_user_id') ?? '').trim();
  const username = String(form.get('username') ?? '').trim() || 'developer';
  if (!/^\d{17,20}$/.test(id)) error(400, 'Enter a Discord user ID (17 to 20 digits).');
  const next = safeNext(String(form.get('next') ?? ''));
  const secure = url.protocol === 'https:';
  if (isRemovalOnly(next)) {
    await writePerson(cookies, env.SESSION_SECRET, { discord_user_id: id, username: username.slice(0, 64) }, secure);
    redirect(303, next);
  }
  const { owner, is_admin } = await relay()!.upsertOwner(id, username.slice(0, 64));
  await writeSession(cookies, env.SESSION_SECRET, { owner_id: owner.id, discord_user_id: owner.discord_user_id, username: owner.username, is_admin }, secure);
  redirect(303, next);
}
