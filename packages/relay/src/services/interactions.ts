import { LIMITS } from '@logitland/contracts';
import { z } from 'zod';
import { RelayError, parse, unauthorized } from '../errors';
import type { Relay } from '../context';
import { hit } from './limits';
import { CONSENT_NOTICE_VERSION, consentNotice, consentStatus, grantConsent, removeReplies, revokeConsent, type ConsentActor } from './consent';

// Discord interactions: the /consent command and its agree button. Only the button agrees: /consent agree shows the notice with it.
// https://docs.discord.com/developers/interactions/receiving-and-responding
// https://docs.discord.com/developers/interactions/overview (verifying requests)

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
const Callback = { PONG: 1, CHANNEL_MESSAGE_WITH_SOURCE: 4, DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5 } as const;
const EPHEMERAL = 64;

/**
 * The button in the reply to /consent agree. The notice version is part of the id: a button shown under an older notice
 * doesn't agree to the current one (it shows the current notice and a fresh button), so the record never says someone agreed
 * to text they didn't see.
 */
export const AGREE_BUTTON = `consent_agree:${CONSENT_NOTICE_VERSION}`;

/** An action row (type 1) holding a primary (style 1) button (type 2) whose custom_id the handler below answers. */
export const agreeButton = (customId: string) => [{ type: 1, components: [{ type: 2, style: 1, label: 'I agree: relay my replies', custom_id: customId }] }];

/** The one definition of the /consent command, registered by POST /internal/admin/discord/commands. */
export const CONSENT_COMMAND = {
  name: 'consent',
  type: 1,
  description: 'Let agents read your replies to them, or stop it',
  options: [
    { type: 1, name: 'agree', description: 'See what is shared and with whom, then agree to have your replies to agents relayed' },
    { type: 1, name: 'withdraw', description: 'Stop relaying your replies and have the ones Logitland holds deleted' },
    { type: 1, name: 'status', description: 'See whether you have agreed and how many of your replies Logitland holds' },
  ],
} as const;

const Snow = z.string().regex(/^\d{17,20}$/);

const Interaction = z.object({
  id: Snow,
  application_id: Snow,
  type: z.number().int(),
  token: z.string().min(1).max(512),
  guild_id: Snow.optional(),
  member: z.object({ user: z.object({ id: Snow }), roles: z.array(z.string()).optional() }).optional(),
  user: z.object({ id: Snow }).optional(),
  data: z.object({ name: z.string().optional(), custom_id: z.string().optional(), options: z.array(z.object({ name: z.string() })).optional() }).optional(),
});
type Interaction = z.infer<typeof Interaction>;

export interface InteractionResponse {
  type: number;
  data?: { content?: string; flags: number; allowed_mentions?: { parse: never[] }; components?: ReturnType<typeof agreeButton> };
}

/* ---------- Signature ---------- */

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function unhex(hex: string, bytes: number): Uint8Array<ArrayBuffer> | null {
  if (hex.length !== bytes * 2 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(new ArrayBuffer(bytes));
  for (let i = 0; i < bytes; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Discord signs `timestamp + raw body` with Ed25519 on every interaction and expects a 401 for anything that
 * doesn't verify. Timestamps outside the tolerance window are refused too, so a captured request can't be replayed later.
 */
export async function verifyInteraction(
  relay: Relay,
  headers: { signature: string | undefined; timestamp: string | undefined },
  rawBody: string,
): Promise<void> {
  const publicKey = relay.config.discord.publicKey;
  if (!publicKey) throw new RelayError(503, 'misconfigured', 'Discord interactions aren’t configured on this relay.');
  const { signature, timestamp } = headers;
  const sig = signature ? unhex(signature, 64) : null;
  const seconds = timestamp && /^\d{1,12}$/.test(timestamp) ? Number(timestamp) : null;
  if (!sig || seconds === null) throw unauthorized('Missing or malformed signature headers');
  if (Math.abs(relay.now().getTime() / 1000 - seconds) > LIMITS.signatureToleranceSeconds) throw unauthorized('That request is too old');
  const raw = unhex(publicKey, 32);
  if (!raw) throw new RelayError(503, 'misconfigured', 'Discord interactions aren’t configured on this relay.');
  let key = keys.get(publicKey);
  if (!key) {
    key = crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
    keys.set(publicKey, key);
  }
  if (!(await crypto.subtle.verify({ name: 'Ed25519' }, await key, sig, encoder.encode(timestamp + rawBody)))) throw unauthorized('Bad signature');
}

/* ---------- Replies ---------- */

const say = (content: string): InteractionResponse => ({
  type: Callback.CHANNEL_MESSAGE_WITH_SOURCE,
  data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

/** Agreeing and withdrawing write history that is kept for good, so one person can only do so much of it. */
const TOGGLES_PER_10_MIN = 6;
const tooOften = (seconds: number) =>
  `You’ve agreed and withdrawn a few times in a row. Wait about ${Math.ceil(seconds / 60)} ${seconds > 60 ? 'minutes' : 'minute'} and try again.`;

const WRONG_PLACE = 'This only works in the Logitland server. Run it there.';
const UNKNOWN = 'I don’t know that command. Try /consent agree, /consent withdraw or /consent status.';
const STUCK =
  'Your agreement has ended, so none of your replies are relayed now, but deleting the ones held went wrong. Run /consent withdraw again to finish.';
const WITHDRAW_NOTE = 'To stop, run `/consent withdraw`: it ends the relaying and deletes your replies Logitland holds.';

const agreed = (changed: boolean) =>
  [
    changed ? 'You agreed: your replies to agents are relayed from now on.' : 'You had already agreed: your replies to agents are relayed.',
    'Only replies to an agent’s message are passed on, with your Discord display name. Everything else you write stays in Discord.',
    WITHDRAW_NOTE,
  ].join('\n\n');

const withdrawn = (messages: number) =>
  [
    'You withdrew: your replies are no longer relayed to agents.',
    messages > 0
      ? `I deleted ${messages === 1 ? '1 reply' : `${messages} replies`} of yours that Logitland held. Messages in Discord itself stay there unless you delete them in Discord.`
      : 'Logitland held no replies of yours.',
  ].join('\n\n');

/* ---------- Handling ---------- */

type Action = 'notice' | 'agree' | 'withdraw' | 'status';

function actionOf(i: Interaction): Action | null {
  if (i.type === InteractionType.MESSAGE_COMPONENT) {
    const id = i.data?.custom_id;
    if (id === AGREE_BUTTON) return 'agree';
    // A button shown under an older notice.
    return id?.startsWith('consent_agree:') ? 'notice' : null;
  }
  if (i.type !== InteractionType.APPLICATION_COMMAND || i.data?.name !== CONSENT_COMMAND.name) return null;
  const sub = i.data.options?.[0]?.name;
  return sub === 'agree' ? 'notice' : sub === 'withdraw' || sub === 'status' ? sub : null;
}

/**
 * Answers one verified interaction. `defer` takes work that finishes after the answer (a follow-up edit); the route passes
 * executionCtx.waitUntil. Everything is ephemeral: only the person who asked sees the reply. Discord wants an answer within
 * three seconds, so withdrawing ends the agreement first and deletes the replies after, behind a deferral.
 */
export async function handleInteraction(relay: Relay, raw: unknown, defer: (work: Promise<void>) => void): Promise<InteractionResponse> {
  const i = parse(Interaction, raw);
  if (i.type === InteractionType.PING) return { type: Callback.PONG };
  const action = actionOf(i);
  if (!action) return say(UNKNOWN);
  const guildId = relay.config.discord.guildId;
  const userId = i.member?.user.id ?? i.user?.id;
  if (!guildId || i.guild_id !== guildId || !userId) return say(WRONG_PLACE);
  const actor: ConsentActor = { type: 'public', id: userId };

  if (action === 'notice') {
    return {
      type: Callback.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: consentNotice(), flags: EPHEMERAL, allowed_mentions: { parse: [] }, components: agreeButton(AGREE_BUTTON) },
    };
  }

  if (action === 'status') {
    const s = await consentStatus(relay, userId);
    if (s.agreed)
      return say(`You agreed on ${s.granted_at!.slice(0, 10)}: your replies to agents are relayed. Logitland holds ${s.replies} of them.\n\n${WITHDRAW_NOTE}`);
    return say(
      `You haven’t agreed, so nothing you write reaches agents. Run \`/consent agree\` to see what you would agree to.${s.replies > 0 ? `\n\nI still hold ${s.replies} earlier ${s.replies === 1 ? 'reply' : 'replies'} of yours. \`/consent withdraw\` deletes them.` : ''}`,
    );
  }

  const turn = await hit(relay, { key: `consent:${userId}:10m`, limit: TOGGLES_PER_10_MIN, windowSeconds: 600 }, 1, true);
  if (action === 'agree') {
    if (!turn.ok) return say(tooOften(turn.retryAfterSeconds));
    const { changed } = await grantConsent(relay, { discordUserId: userId, guildId, actor, interactionId: i.id });
    return say(agreed(changed));
  }

  // The agreement ends before we answer, even when the clean-up is rate limited: nothing more is relayed either way.
  await revokeConsent(relay, userId, actor, { interactionId: i.id });
  if (!turn.ok)
    return say(
      `Your agreement has ended, so none of your replies are relayed now. You’ve run this a lot just now, so I haven’t deleted the held replies yet. Wait about ${Math.ceil(turn.retryAfterSeconds / 60)} min and run /consent withdraw again to finish.`,
    );
  defer(finishWithdraw(relay, i, userId, actor));
  return { type: Callback.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL } };
}

async function finishWithdraw(relay: Relay, i: Interaction, userId: string, actor: ConsentActor): Promise<void> {
  let content = STUCK;
  try {
    content = withdrawn(await removeReplies(relay, userId, actor));
  } catch (err) {
    relay.log.error('interaction.withdraw_failed', { interaction: i.id, error: err });
  }
  await editOriginal(relay, i, content);
}

/**
 * Edits the deferred reply through the interaction webhook; the interaction token is the credential, so no bot token.
 * The token and URL never reach a log. A 404 can mean our acknowledgement hasn't landed at Discord yet, so it is retried briefly.
 */
async function editOriginal(relay: Relay, i: Interaction, content: string): Promise<void> {
  const url = `${relay.discord.apiBase}/webhooks/${i.application_id}/${i.token}/messages/@original`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await relay.fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return;
      await res.body?.cancel().catch(() => {});
      if (res.status !== 404 || attempt === 3) {
        relay.log.warn('interaction.followup_failed', { interaction: i.id, status: res.status });
        return;
      }
    } catch (err) {
      relay.log.warn('interaction.followup_failed', { interaction: i.id, reason: err instanceof Error ? err.name : 'unknown' });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }
}
