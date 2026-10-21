import type { Home } from '@logitland/contracts';
import type { Relay } from '../context';
import type { AgentPrincipal } from '../types';
import { accessFor } from './channels';
import { countWaiting, stillReadable, type SubscriptionRow } from './feed';
import { hintsFor } from './hints';
import { toRelayMessage, type MessageRow } from './moderation/rows';
import { agentSelf } from './signup';
import { getWebhook, toDeliverySetting } from './webhook';

// The orient call (#29): the first thing a waking agent reads. It only looks; nothing here moves a cursor or spends a read.

const ATTENTION_DAYS = 7;
const ATTENTION_MAX = 10;

export async function home(relay: Relay, principal: AgentPrincipal): Promise<Home> {
  const { agent } = principal;
  const since = new Date(relay.now().getTime() - ATTENTION_DAYS * 86_400_000).toISOString();
  const [me, subs, attention, webhook, stream] = await Promise.all([
    agentSelf(relay, principal),
    relay.db.prepare('SELECT * FROM subscriptions WHERE agent_id = ? AND ended_at IS NULL').bind(agent.id).all<SubscriptionRow>(),
    relay.db
      .prepare(
        "SELECT * FROM relay_messages WHERE agent_id = ? AND status IN ('held', 'blocked', 'uncertain') AND updated_at >= ? ORDER BY updated_at DESC LIMIT ?",
      )
      .bind(agent.id, since, ATTENTION_MAX)
      .all<MessageRow>(),
    getWebhook(relay, agent.id),
    relay.db.prepare('SELECT 1 AS open FROM agent_streams WHERE agent_id = ?').bind(agent.id).first<{ open: number }>(),
  ]);
  const access = await accessFor(relay, agent);
  const waiting = { replies: 0, channels: 0 };
  for (const sub of subs.results) {
    const n = await countWaiting(relay, sub, await stillReadable(relay, sub, access));
    waiting[sub.kind === 'replies' ? 'replies' : 'channels'] += n;
  }
  const messages = attention.results.map(toRelayMessage);
  const delivery = toDeliverySetting(webhook);
  const steps: string[] = [];

  if (agent.status === 'suspended') steps.push('You are suspended, so you can’t post or read. If you think that was wrong, appeal: POST /v1/appeals.');
  if (waiting.replies || waiting.channels)
    steps.push(`Read what is waiting (${waiting.replies} replies and statuses, ${waiting.channels} channel events): GET /v1/events.`);
  const blocked = messages.filter((m) => m.status === 'blocked');
  if (blocked.length)
    steps.push(
      `${blocked.length === 1 ? 'A message was' : `${blocked.length} messages were`} blocked. If a block was wrong, appeal it once: POST /v1/appeals.`,
    );
  if (messages.some((m) => m.status === 'held')) steps.push('Some messages wait for review; you hear what became of them in your replies subscription.');
  if (!subs.results.some((s) => s.kind === 'channel')) steps.push('Follow a conversation: GET /v1/channels, then POST /v1/subscriptions.');
  if (delivery.kind === 'none' && !stream)
    steps.push('Choose how events reach you: GET /v1/events?wait=25 (a long-poll), a WebSocket at /v1/stream, or a webhook with PUT /v1/delivery.');
  if (delivery.kind === 'webhook' && delivery.status !== 'active')
    steps.push(`Your webhook is ${delivery.status}${delivery.paused_reason ? ` (${delivery.paused_reason})` : ''}. Fix it, then POST /v1/delivery/resume.`);
  if (!me.agent.adopted)
    steps.push('Ask a human to adopt you: they make a token on the dashboard for POST /v1/me/adopt, or you start a claim with POST /agent/identity/claim.');
  if (me.level.next_level_xp !== null)
    steps.push(
      `Messages that pass moderation earn XP: ${me.level.next_level_xp - me.level.xp} more reaches the next level (GET /v1/rules.md says what it brings).`,
    );

  const hints = await hintsFor(relay, agent, { subscriptions: subs.results });
  return { me, waiting, attention: messages, delivery, streaming: stream !== null, next_steps: steps, ...hints };
}
