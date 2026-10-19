import { fail } from '@sveltejs/kit';
import {
  CONVERSATION,
  CONVERSATION_CHANNEL,
  OUTGOING,
  PATH,
  UNCERTAIN,
  type ConversationItem,
  type OutgoingRow,
  type PathStep,
  type UncertainSend,
} from '#lib/fixtures/messages.js';
import { clock, stamp } from '#lib/format.js';
import { MESSAGE_STATUS_LABEL, MESSAGE_STATUS_TONE, policyLabel } from '#lib/labels.js';
import type { OwnerMessage } from '@logitland/contracts';
import { channelLabel, channelNames } from '#lib/server/channel-names.js';
import { attempt, refused, signedIn } from '#lib/server/guard.js';
import { relay, simulate } from '#lib/server/relay.js';

interface MessagesView {
  /** Pass as `?before=` for older messages. */
  older: string | null;
  path: PathStep[] | null;
  uncertain: UncertainSend[];
  outgoing: OutgoingRow[];
  conversation: { agent: string; channel: string; items: ConversationItem[] } | null;
  live: boolean;
}

const trim = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

function noteFor(m: OwnerMessage, agent: string): string | undefined {
  const why = m.policy_code ? policyLabel(m.policy_code).toLowerCase() : null;
  const reason = m.status_reason ? ` ${m.status_reason}` : '';
  // A message Discord has an ID for was posted; one without never reached it.
  const onDiscord = m.discord_message_id !== null;
  switch (m.status) {
    case 'held':
      return m.policy_code === 'outage'
        ? 'Moderation was unavailable, so the relay checks it again by itself. Nothing was posted.'
        : `${agent} was told “held”.${why ? ` Reason: ${why}.` : ''}${reason} Nothing was posted.`;
    case 'blocked':
      return `${why ? `Reason: ${why}. ` : ''}${agent} got the refusal.${reason}`;
    case 'uncertain':
      return 'Discord didn’t confirm. Decide above.';
    // The reason leads: it says why (the hold cap, a broken webhook, a switched-off agent), which is not always Discord's doing.
    case 'failed':
      return `${m.status_reason ?? 'It didn’t go out.'}${onDiscord ? '' : ' Nothing was posted.'}`;
    case 'removed':
      return `${m.status_reason ?? 'It was removed.'}${onDiscord ? ' It is no longer in Discord.' : m.status_reason ? '' : ' It was never posted.'}`;
    case 'moderating':
      return 'Still being checked.';
    case 'queued':
      return 'Waiting its turn for the channel.';
    case 'sending':
      return 'On its way to Discord.';
    case 'sent':
      return undefined;
  }
}

export async function load({ locals, url }): Promise<MessagesView> {
  const client = relay();
  if (!client || !locals.viewer)
    return { older: null, path: PATH, uncertain: UNCERTAIN, outgoing: OUTGOING, conversation: { ...CONVERSATION_CHANNEL, items: CONVERSATION }, live: false };

  // Relay mode: the list and the decisions are real. The path counts and what an agent reads have no endpoint, so those parts are left out.
  const ownerId = locals.viewer.owner_id;
  const [{ messages, next_before }, names] = await Promise.all([
    client.listMessages(ownerId, { before: url.searchParams.get('before') || undefined }),
    channelNames(client, ownerId),
  ]);
  const now = Date.now();
  const sorted = [...messages].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const outgoing = sorted.map((m): OutgoingRow => {
    const agent = m.agent_name;
    return {
      id: m.id,
      at: stamp(m.created_at, now),
      agent,
      channel: channelLabel(m.channel_id, names),
      text: m.status === 'removed' ? 'The text was removed with the message.' : (m.content ?? 'Hidden message'),
      withheld: m.status === 'blocked' || m.content === null,
      note: noteFor(m, agent),
      status: m.status,
      statusLabel: MESSAGE_STATUS_LABEL[m.status],
      tone: MESSAGE_STATUS_TONE[m.status],
    };
  });
  const uncertain = sorted
    .filter((m) => m.status === 'uncertain')
    .map((m): UncertainSend => {
      const agent = m.agent_name;
      const at = clock(m.created_at);
      return {
        id: m.id,
        title: `Did ${agent}’s ${at} message post?`,
        quote: trim(m.content ?? 'Hidden message', 280),
        explanation: `The relay sent it, but Discord didn’t confirm that it received it: the request timed out, the connection dropped, or Discord answered with an error. Discord webhooks take no idempotency key, so sending again blindly could post it twice. Look in ${channelLabel(m.channel_id, names)}: if it’s there, mark it as posted. If it isn’t, send it again.`,
        results: { resend: 'Sent again. If the first one landed, there are now two copies.', accept: `Marked as posted. ${agent} now sees it as sent.` },
      };
    });
  return { older: next_before, path: null, uncertain, outgoing, conversation: null, live: true };
}

async function resolve(locals: App.Locals, url: URL, request: Request, action: 'resend' | 'accept', ms: number) {
  const viewer = signedIn(locals, url);
  const id = String((await request.formData()).get('id') ?? '');
  const client = relay();
  if (!client) {
    if (!UNCERTAIN.some((u) => u.id === id)) return fail(404, { message: 'No such message.' });
    await simulate(ms);
    return { decided: action, id };
  }
  const r = await attempt(() => client.resolveMessage(viewer.owner_id, id, action));
  if (!r.ok) return refused(r.refusal);
  return { decided: action, id };
}

export const actions = {
  resend: ({ locals, url, request }) => resolve(locals, url, request, 'resend', 800),
  accept: ({ locals, url, request }) => resolve(locals, url, request, 'accept', 600),
};
