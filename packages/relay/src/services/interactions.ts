import { LIMITS, type ConsentMethod } from '@logitland/contracts';
import { DISCORD_API } from '@logitland/discord';
import { z } from 'zod';
import { RelayError, parse, unauthorized } from '../errors';
import type { Relay } from '../context';
import { consentStatus, grantConsent, messageCount, removePerson, revokeConsent, type ConsentActor } from './consent';

// Discord interactions: the /mirror command and the welcome message's button.
// https://docs.discord.com/developers/interactions/receiving-and-responding
// https://docs.discord.com/developers/interactions/overview (verifying requests)

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
const Callback = { PONG: 1, CHANNEL_MESSAGE_WITH_SOURCE: 4, DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5 } as const;
const EPHEMERAL = 64;

export const AGREE_BUTTON = 'mirror_agree';

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
  data?: { content?: string; flags: number; allowed_mentions?: { parse: never[] } };
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

const WRONG_PLACE = 'This only works in the Logitland server. Run it there.';
const UNKNOWN = 'I don’t know that command. Try /mirror agree, /mirror leave or /mirror status.';
const STUCK =
  'Something went wrong while removing your messages. Your agreement has ended, so nothing you write is shown publicly now. Run /mirror leave again to finish.';

const LEAVE_NOTE = 'To leave, run `/mirror leave`: it takes the role away and deletes your messages from the mirror.';

const agreed = (publicUrl: string, changed: boolean, roleGranted: boolean) =>
  [
    changed ? 'You agreed to the Logitland public mirror.' : 'You had already agreed to the Logitland public mirror.',
    `What you write in the relayed channels is copied to a public page that anyone can read without signing in, together with your Discord display name: ${publicUrl}`,
    roleGranted
      ? 'You have the role that lets you chat in those channels.'
      : 'I saved your agreement but couldn’t give you the chat role just now. Run `/mirror agree` again in a minute, and if it keeps failing, ask a moderator.',
    LEAVE_NOTE,
  ].join('\n\n');

const VIA: Record<ConsentMethod, string> = { command: 'the /mirror command', button: 'the welcome button', dashboard: 'the dashboard' };

const left = (messages: number, roleRemoved: boolean) =>
  [
    'You left the Logitland public mirror.',
    messages > 0
      ? `I deleted ${messages} of your ${messages === 1 ? 'message' : 'messages'} from the mirror. Messages in Discord itself stay there unless you delete them in Discord.`
      : 'I had no messages of yours to delete from the mirror.',
    roleRemoved ? 'The chat role is gone.' : 'I couldn’t take the chat role away. Ask a moderator to remove it.',
  ].join('\n\n');

/* ---------- Handling ---------- */

type Action = { kind: 'agree' | 'leave' | 'status'; method: ConsentMethod };

function actionOf(i: Interaction): Action | null {
  if (i.type === InteractionType.MESSAGE_COMPONENT) return i.data?.custom_id === AGREE_BUTTON ? { kind: 'agree', method: 'button' } : null;
  if (i.type !== InteractionType.APPLICATION_COMMAND || i.data?.name !== 'mirror') return null;
  const sub = i.data.options?.[0]?.name;
  return sub === 'agree' || sub === 'leave' || sub === 'status' ? { kind: sub, method: 'command' } : null;
}

/**
 * Answers one verified interaction. `defer` takes work that finishes after the answer (a follow-up edit); the route
 * passes executionCtx.waitUntil. Everything is ephemeral: only the person who asked sees the reply.
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

  if (action.kind === 'agree') {
    const { changed, roleGranted } = await grantConsent(relay, { discordUserId: userId, guildId, method: action.method, actor });
    return say(agreed(relay.config.publicUrl, changed, roleGranted));
  }

  if (action.kind === 'status') {
    const s = await consentStatus(relay, userId);
    if (s.agreed) {
      return say(
        `You agreed to the public mirror on ${s.granted_at!.slice(0, 10)} with ${VIA[s.method!]}. ${s.mirrored_messages} of your messages in the mirrored channels are shown publicly.\n\n${LEAVE_NOTE}`,
      );
    }
    const held = s.mirrored_messages;
    return say(
      `You haven’t agreed to the public mirror, so what you write isn’t shown publicly. Run \`/mirror agree\` to join.${held > 0 ? `\n\nI still hold ${held} earlier ${held === 1 ? 'message' : 'messages'} of yours from mirrored channels. \`/mirror leave\` deletes them.` : ''}`,
    );
  }

  const status = await consentStatus(relay, userId);
  const roleId = relay.config.discord.consentRoleId;
  const hasRole = Boolean(roleId && i.member?.roles?.includes(roleId));
  if (!status.agreed && !hasRole && (await messageCount(relay, userId, 'all')) === 0)
    return say('You haven’t agreed to the mirror and I hold no messages from you, so there is nothing to remove.');
  // The agreement ends before we answer, so the public view hides this person at once even if the rest fails.
  await revokeConsent(relay, userId, actor);
  defer(finishLeave(relay, i, userId, guildId, actor));
  return { type: Callback.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL } };
}

async function finishLeave(relay: Relay, i: Interaction, userId: string, guildId: string, actor: ConsentActor): Promise<void> {
  let content = STUCK;
  try {
    const r = await removePerson(relay, { discordUserId: userId, guildId, actor });
    content = left(r.messages, r.roleRemoved);
  } catch (err) {
    relay.log.error('interaction.leave_failed', { interaction: i.id, error: err });
  }
  await editOriginal(relay, i, content);
}

/**
 * Edits the deferred reply through the interaction webhook; the interaction token is the credential, so no bot token.
 * The token and URL never reach a log. A 404 can mean our acknowledgement hasn't landed at Discord yet, so it is retried briefly.
 */
async function editOriginal(relay: Relay, i: Interaction, content: string): Promise<void> {
  const url = `${DISCORD_API}/webhooks/${i.application_id}/${i.token}/messages/@original`;
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
