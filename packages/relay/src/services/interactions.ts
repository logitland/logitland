import { LIMITS, type ConsentMethod } from '@logitland/contracts';
import { z } from 'zod';
import { RelayError, parse, unauthorized } from '../errors';
import type { Relay } from '../context';
import { consentNotice, consentStatus, grantConsent, removePerson, revokeConsent, syncRole, type ConsentActor } from './consent';

// Discord interactions: the /mirror command and the agree buttons. Only a button click agrees: /mirror agree shows the
// notice with a button, and so does the welcome message.
// https://docs.discord.com/developers/interactions/receiving-and-responding
// https://docs.discord.com/developers/interactions/overview (verifying requests)

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
const Callback = { PONG: 1, CHANNEL_MESSAGE_WITH_SOURCE: 4, DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5 } as const;
const EPHEMERAL = 64;

/** The button on the welcome message (consent method `button`), and the one in the reply to /mirror agree (method `command`). */
export const AGREE_BUTTON = 'mirror_agree';
export const AGREE_COMMAND_BUTTON = 'mirror_agree_cmd';

/** An action row (type 1) holding a primary (style 1) button (type 2) whose custom_id the handler below answers. */
export const agreeButton = (customId: string) => [{ type: 1, components: [{ type: 2, style: 1, label: 'I agree: let me chat', custom_id: customId }] }];

/**
 * The one definition of the /mirror command. POST /internal/admin/discord/commands registers it, and
 * apps/backend/scripts/register-commands.mjs must send exactly this (a test compares them).
 */
export const MIRROR_COMMAND = {
  name: 'mirror',
  type: 1,
  description: 'Join or leave the Logitland public mirror',
  options: [
    { type: 1, name: 'agree', description: 'See what the public mirror shares and with whom, then agree to get the role that lets you chat' },
    { type: 1, name: 'leave', description: 'Leave the public mirror, lose the chat role and have what Logitland holds of yours deleted' },
    { type: 1, name: 'status', description: 'See whether you have agreed and how many of your messages are on the mirror' },
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

const WRONG_PLACE = 'This only works in the Logitland server. Run it there.';
const UNKNOWN = 'I don’t know that command. Try /mirror agree, /mirror leave or /mirror status.';
const STUCK =
  'Something went wrong while removing your messages. Your agreement has ended, so nothing you write is shown publicly now. Run /mirror leave again to finish.';

const LEAVE_NOTE = 'To leave, run `/mirror leave`: it takes the role away and deletes your messages from the mirror.';

const agreed = (dashboardUrl: string, changed: boolean, roleGranted: boolean) =>
  [
    changed ? 'You agreed to the Logitland public mirror.' : 'You had already agreed to the Logitland public mirror.',
    `From now on, what you write in the relayed channels is copied as described in the notice, together with your Discord display name. Nothing from before you agreed is. What is shared and with whom: ${dashboardUrl}/privacy`,
    roleGranted
      ? 'You have the chat role.'
      : 'I saved your agreement but couldn’t give you the chat role just now. Run `/mirror agree` and press the button again in a minute, and if it keeps failing, ask a moderator.',
    LEAVE_NOTE,
  ].join('\n\n');

const VIA: Record<ConsentMethod, string> = { command: 'the /mirror command', button: 'the welcome button' };

const left = (messages: number, roleRemoved: boolean) =>
  [
    'You left the Logitland public mirror.',
    messages > 0
      ? `I deleted ${messages === 1 ? '1 message' : `${messages} messages`} of yours from the mirror. Messages in Discord itself stay there unless you delete them in Discord.`
      : 'I had no messages of yours to delete from the mirror.',
    roleRemoved ? 'The chat role is gone.' : 'I couldn’t take the chat role away. Ask a moderator to remove it.',
  ].join('\n\n');

/* ---------- Handling ---------- */

type Action = { kind: 'notice' | 'leave' | 'status' } | { kind: 'agree'; method: ConsentMethod };

function actionOf(i: Interaction): Action | null {
  if (i.type === InteractionType.MESSAGE_COMPONENT) {
    const id = i.data?.custom_id;
    return id === AGREE_BUTTON ? { kind: 'agree', method: 'button' } : id === AGREE_COMMAND_BUTTON ? { kind: 'agree', method: 'command' } : null;
  }
  if (i.type !== InteractionType.APPLICATION_COMMAND || i.data?.name !== 'mirror') return null;
  const sub = i.data.options?.[0]?.name;
  return sub === 'agree' ? { kind: 'notice' } : sub === 'leave' || sub === 'status' ? { kind: sub } : null;
}

/**
 * Answers one verified interaction. `defer` takes work that finishes after the answer (a follow-up edit); the route
 * passes executionCtx.waitUntil. Everything is ephemeral: only the person who asked sees the reply. Discord wants an
 * answer within three seconds, so agreeing and leaving write to the database first and answer with a deferral; the
 * Discord role (a REST call that can be slow) is dealt with after, and so is the scrub.
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

  if (action.kind === 'notice') {
    return {
      type: Callback.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: consentNotice(relay.config.dashboardUrl),
        flags: EPHEMERAL,
        allowed_mentions: { parse: [] },
        components: agreeButton(AGREE_COMMAND_BUTTON),
      },
    };
  }

  if (action.kind === 'agree') {
    const { changed } = await grantConsent(relay, { discordUserId: userId, guildId, method: action.method, actor, interactionId: i.id });
    defer(finishAgree(relay, i, userId, guildId, changed));
    return { type: Callback.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL } };
  }

  if (action.kind === 'status') {
    const s = await consentStatus(relay, userId);
    if (s.agreed) {
      return say(
        `You agreed to the public mirror on ${s.granted_at!.slice(0, 10)} with ${VIA[s.method!]}. Only what you wrote after that is shown. ${s.mirrored_messages} of your messages in the mirrored channels are on the mirror.\n\n${LEAVE_NOTE}`,
      );
    }
    const held = s.mirrored_messages;
    return say(
      `You haven’t agreed to the public mirror, so what you write isn’t copied: Logitland keeps only that a message was sent, and when and where, not who wrote it or what it said. Run \`/mirror agree\` to see what you would agree to.${held > 0 ? `\n\nI still hold ${held} earlier ${held === 1 ? 'message' : 'messages'} of yours from mirrored channels. \`/mirror leave\` deletes them.` : ''}`,
    );
  }

  // The agreement ends before we answer, so readers lose this person at once even if the rest fails. Leaving always runs the
  // whole clean-up, even for someone with no agreement and no live messages: tombstones and reply lines may still name them.
  await revokeConsent(relay, userId, actor, { interactionId: i.id });
  defer(finishLeave(relay, i, userId, guildId, actor));
  return { type: Callback.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL } };
}

/** The chat role follows the agreement as it stands when this runs, so an agree and a leave that overlap end up consistent. */
async function finishAgree(relay: Relay, i: Interaction, userId: string, guildId: string, changed: boolean): Promise<void> {
  let roleGranted = false;
  try {
    roleGranted = await syncRole(relay, guildId, userId);
  } catch (err) {
    relay.log.error('interaction.agree_failed', { interaction: i.id, error: err });
  }
  await editOriginal(relay, i, agreed(relay.config.dashboardUrl, changed, roleGranted));
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
