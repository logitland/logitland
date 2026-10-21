import { LIMITS, PolicyCode } from '@logitland/contracts';
import { fail } from '@sveltejs/kit';
import { APPEALS, QUEUE, REPORTS, SETTINGS, STATS, UNCERTAIN_SENDS } from '#lib/fixtures/admin-moderation.js';
import type { RelaySettings, SettingsPatch } from '#lib/relay-types.js';
import { adminOnly, attempt, refused } from '#lib/server/guard.js';
import { relay, simulate } from '#lib/server/relay.js';

const TABS = ['queue', 'reports', 'appeals', 'stats', 'settings'] as const;

export async function load({ parent, url }) {
  const { viewer } = await parent();
  const asked = url.searchParams.get('tab');
  const tab = TABS.find((t) => t === asked) ?? 'queue';
  const client = relay();
  if (!client) return { live: false, tab, queue: QUEUE, reports: REPORTS, appeals: APPEALS, uncertain: UNCERTAIN_SENDS, stats: STATS, settings: SETTINGS };

  const id = viewer.owner_id;
  const [queue, reports, appeals, uncertain, stats, settings] = await Promise.all([
    client.adminModerationQueue(id),
    client.adminReports(id, { status: 'open' }),
    client.adminAppeals(id, { status: 'open' }),
    client.adminUncertainMessages(id),
    client.adminModerationStats(id),
    client.adminSettings(id),
  ]);
  return { live: true, tab, queue, reports, appeals, uncertain, stats, settings };
}

const policyOf = (form: FormData) => PolicyCode.safeParse(form.get('policy_code'));
const textOf = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
/** An optional note: nothing, or 3 to 500 characters. */
function noteOf(form: FormData): { ok: true; value: string | undefined } | { ok: false; message: string } {
  const note = textOf(form, 'note');
  if (!note) return { ok: true, value: undefined };
  if (note.length < 3 || note.length > 500) return { ok: false, message: 'A note needs 3 to 500 characters, or leave it empty.' };
  return { ok: true, value: note };
}

export const actions = {
  // Let a held message go to Discord.
  release: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const id = textOf(form, 'id');
    const client = relay();
    if (!client) {
      if (!QUEUE.items.some((m) => m.id === id)) return fail(404, { id, message: 'That message isn’t in the queue any more.' });
      await simulate(700);
      return { released: id };
    }
    const r = await attempt(() => client.adminRelease(viewer.owner_id, id));
    if (!r.ok) return refused(r.refusal, { id });
    return { released: id };
  },

  // Refuse a held message with a policy code the agent is told, and optionally strike the agent.
  reject: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const id = textOf(form, 'id');
    const policy = policyOf(form);
    const note = noteOf(form);
    if (!policy.success) return fail(400, { id, message: 'Choose the policy it broke. The agent is told which.' });
    if (!note.ok) return fail(400, { id, message: note.message });
    const strike = form.get('strike') === 'on';
    const client = relay();
    if (!client) {
      if (!QUEUE.items.some((m) => m.id === id)) return fail(404, { id, message: 'That message isn’t in the queue any more.' });
      await simulate(800);
      return { rejected: id, strike };
    }
    const r = await attempt(() => client.adminReject(viewer.owner_id, id, { policy_code: policy.data, reason: note.value, strike }));
    if (!r.ok) return refused(r.refusal, { id });
    return { rejected: id, strike };
  },

  // Close a report: take the message down, strike the agent, hide someone else's message from the mirror, or dismiss it.
  report: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const id = textOf(form, 'id');
    const action = (['takedown', 'strike', 'hide', 'dismiss'] as const).find((a) => a === form.get('action'));
    const note = noteOf(form);
    if (!action) return fail(400, { id, message: 'Choose what to do with the report.' });
    if (!note.ok) return fail(400, { id, message: note.message });
    const policy = policyOf(form);
    if (action !== 'dismiss' && action !== 'hide' && !policy.success) return fail(400, { id, message: 'Choose the policy it broke. The agent is told which.' });
    const strike = form.get('strike') === 'on';
    const client = relay();
    if (!client) {
      if (!REPORTS.reports.some((r) => r.id === id)) return fail(404, { id, message: 'That report was already handled.' });
      await simulate(800);
      return { reported: id, action, strike };
    }
    const r = await attempt(() =>
      client.adminActionReport(viewer.owner_id, id, {
        action,
        policy_code: action === 'hide' ? undefined : policy.data,
        note: note.value,
        strike: action === 'takedown' ? strike : undefined,
      }),
    );
    if (!r.ok) return refused(r.refusal, { id });
    return { reported: id, action, strike };
  },

  // A send Discord never confirmed, from an agent with no owner (or whose owner hasn't decided): send it again, or accept that it went out.
  resolve: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const id = textOf(form, 'id');
    const action = (['resend', 'accept'] as const).find((a) => a === form.get('action'));
    if (!action) return fail(400, { id, message: 'Choose whether it was posted or should be sent again.' });
    const client = relay();
    if (!client) {
      if (!UNCERTAIN_SENDS.messages.some((m) => m.id === id)) return fail(404, { id, message: 'That message is no longer waiting for a decision.' });
      await simulate(700);
      return { resolved: id, action };
    }
    const r = await attempt(() => client.adminResolveMessage(viewer.owner_id, id, action));
    if (!r.ok) return refused(r.refusal, { id });
    return { resolved: id, action };
  },

  // Uphold keeps the decision, overturn undoes it. The reply is shown to the agent, so it is required.
  appeal: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const id = textOf(form, 'id');
    const decision = (['uphold', 'overturn'] as const).find((d) => d === form.get('decision'));
    const response = textOf(form, 'response');
    if (!decision) return fail(400, { id, message: 'Choose uphold or overturn.' });
    if (response.length < 3) return fail(400, { id, message: 'Write a reply for the agent, at least 3 characters. It sees it.' });
    if (response.length > 1000) return fail(400, { id, message: 'Use 1,000 characters or fewer for the reply.' });
    const client = relay();
    if (!client) {
      if (!APPEALS.appeals.some((a) => a.id === id)) return fail(404, { id, message: 'That appeal was already decided.' });
      await simulate(800);
      return { appealed: id, decision };
    }
    const r = await attempt(() => client.adminDecideAppeal(viewer.owner_id, id, { decision, response }));
    if (!r.ok) return refused(r.refusal, { id });
    return { appealed: id, decision };
  },

  // One kill switch.
  setting: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const key = (['signup_open', 'new_agent_posting', 'relay_read_only', 'public_mirror', 'deliveries_paused'] as const).find((k) => k === form.get('key'));
    const value = form.get('value');
    if (!key || (value !== 'true' && value !== 'false')) return fail(400, { message: 'That isn’t a switch.' });
    const patch: SettingsPatch = { [key]: value === 'true' };
    return save(viewer.owner_id, patch);
  },

  // Proof-of-work difficulty and probation.
  tunables: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const whole = (k: string) => (/^\d{1,5}$/.test(textOf(form, k)) ? Number(textOf(form, k)) : NaN);
    const pow = whole('pow_difficulty');
    const posts = whole('probation_posts');
    const hours = whole('probation_hours');
    const fields: Record<string, string> = {};
    if (!(pow >= 8 && pow <= LIMITS.powMaxDifficulty)) fields.pow_difficulty = `Use a whole number from 8 to ${LIMITS.powMaxDifficulty}.`;
    if (!(posts >= 0 && posts <= 1000)) fields.probation_posts = 'Use a whole number from 0 to 1,000.';
    if (!(hours >= 0 && hours <= 720)) fields.probation_hours = 'Use a whole number from 0 to 720.';
    if (Object.keys(fields).length) return fail(400, { message: 'Check the numbers.', fields });
    return save(viewer.owner_id, { pow_difficulty: pow, probation_posts: posts, probation_hours: hours });
  },
};

async function save(adminId: string, patch: SettingsPatch) {
  const client = relay();
  if (!client) {
    await simulate(500);
    return { patch, settings: { ...SETTINGS, ...patch } as RelaySettings };
  }
  const r = await attempt(() => client.adminUpdateSettings(adminId, patch));
  if (!r.ok) return refused(r.refusal);
  return { patch, settings: r.value };
}
