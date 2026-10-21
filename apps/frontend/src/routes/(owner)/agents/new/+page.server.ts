import { fail } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { newId } from '@logitland/contracts';
import { NEW_AGENT_DEFAULTS, PREVIEW_AGENT_ID, type NewAgentForm } from '#lib/fixtures/new-agent.js';
import { attempt, signedIn } from '#lib/server/guard.js';
import { relay, simulate } from '#lib/server/relay.js';
import { FIELD_OF, readValues, validate, type CreatedAgent, type FieldErrors } from './rules.js';

const BLANK: NewAgentForm = { name: '', purpose: '', label: '', scopes: ['messages:read', 'messages:write'] };

// Relay mode: the preview flock and the prefilled example are fixtures-only; the form starts blank.
export function load() {
  const live = relay() !== null;
  const firstCall = [
    `curl ${env.RELAY_PUBLIC_URL}/v1/messages \\`,
    '  -H "Authorization: Bearer $LOGITLAND_KEY" \\',
    '  -H "Idempotency-Key: 4f1c9a…" \\',
    `  -d '{"channel_id":"1290…","content":"hello"}'`,
  ].join('\n');
  return { live, previewId: live ? null : PREVIEW_AGENT_ID, defaults: live ? BLANK : NEW_AGENT_DEFAULTS, firstCall };
}

/** The visitor's address, if the platform can say; the relay uses it to refuse registrations from addresses banned agents used. */
function clientAddress(get: () => string): string | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** An example key in the relay's format (randomToken('lk_') in packages/relay): 240 random bits, Crockford base32. */
function exampleKey(): string {
  let out = 'lk_';
  let acc = 0;
  let bits = 0;
  for (const byte of crypto.getRandomValues(new Uint8Array(30))) {
    acc = ((acc << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD.charAt((acc >> bits) & 31);
    }
  }
  return out;
}

export const actions = {
  default: async ({ request, locals, url, getClientAddress }) => {
    const viewer = signedIn(locals, url);
    const values = readValues(await request.formData());
    const checked = validate(values);
    if (!checked.ok) return fail(400, { errors: checked.errors, values });

    const client = relay();
    if (client) {
      const r = await attempt(() => client.createAgent(viewer.owner_id, checked.request, clientAddress(getClientAddress)));
      if (!r.ok) {
        const errors: FieldErrors = {};
        for (const [path, text] of Object.entries(r.refusal.fields)) {
          const field = FIELD_OF[path];
          if (field) errors[field] ??= text;
        }
        return fail(r.refusal.status, { errors, values, error: r.refusal.message });
      }
      const { agent, key } = r.value;
      const created: CreatedAgent = { name: agent.name, label: values.label.trim(), key: { id: key.id, secret: key.secret, scopes: key.scopes } };
      return { created, values };
    }

    await simulate(800);
    const created: CreatedAgent = {
      name: checked.request.name,
      label: values.label.trim(),
      key: { id: newId('key'), secret: exampleKey(), scopes: checked.request.scopes },
    };
    return { created, values };
  },
};
