import { fail, redirect } from '@sveltejs/kit';
import { UserCode } from '@logitland/contracts';
import { EXAMPLE_CODE } from '#lib/fixtures/claim.js';
import { CLAIM_BODY_MAX, bodyWithin } from '#lib/server/body-limit.js';
import { dataSource } from '#lib/server/relay.js';

export function load() {
  // Fixtures mode prefills the example claim's code, as the prototype does.
  return { prefill: dataSource() === 'fixtures' ? EXAMPLE_CODE : '' };
}

/** Accept what people actually type: lower case, stray spaces, or the eight characters without the dash. */
function normalise(raw: string): string {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  return /^[0-9A-Z]{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export const actions = {
  default: async ({ request }) => {
    // Nothing here is signed-in yet, so don't buffer a body bigger than a code could need.
    if (!bodyWithin(request, CLAIM_BODY_MAX)) return fail(413, { code: '', error: 'That is too long to be a code. Enter a code like 7QFM-KX2D.' });
    const raw = String((await request.formData()).get('code') ?? '');
    const code = normalise(raw);
    if (!code) return fail(400, { code: raw, error: 'Enter the code your agent showed you.' });
    if (!UserCode.safeParse(code).success) return fail(400, { code: raw, error: 'Enter a code like 7QFM-KX2D.' });
    redirect(303, `/claim/${code}`);
  },
};
