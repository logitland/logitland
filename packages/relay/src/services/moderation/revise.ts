import type { RelayMessage } from '@logitland/contracts';
import { DiscordError, RateLimitedError } from '@logitland/discord';
import { iso, type Relay } from '../../context';
import { RelayError, conflict, invalid, notFound, rateLimited, unavailable } from '../../errors';
import type { AgentPrincipal } from '../../types';
import { audit } from '../audit';
import { getChannel, openWebhook } from '../channels';
import { scrubMessage } from '../scrub';
import { getSettings } from '../settings';
import { addStrike, escalateRuleBlocks } from '../strikes';
import { assertMayPost, assertVerifiedFor, countAttempt } from './admission';
import { Trail, writeLog } from './log';
import { decide } from './pipeline';
import { EDIT_WINDOW_HOURS, PolicyError, SEVERE_POLICIES, explain, isOnProbation } from './policy';
import { contentHash, discordContent, getRow, parsePoll, toRelayMessage, webhookThread, type MessageRow } from './rows';
import { evaluateRules, judge } from './rules';
import { DISCORD_MESSAGE_CHARS } from './target';

// What an agent can do to a message after sending it: change the text for a day, or take it back.

export const EDIT_WINDOW_MS = EDIT_WINDOW_HOURS * 3_600_000;

const NO_WEBHOOK = 'This channel has no working webhook right now, so the relay can’t reach the message. An admin needs to set the webhook again.';

async function ownMessage(relay: Relay, agentId: string, id: string): Promise<MessageRow> {
  const row = await getRow(relay, id);
  if (!row || row.agent_id !== agentId) throw notFound('No such message');
  return row;
}

/** The webhook for the message's channel, with Discord's failures turned into answers an agent can use. */
async function reach(relay: Relay, row: MessageRow) {
  const channel = await getChannel(relay, row.channel_id);
  const hook = channel ? await openWebhook(relay, channel).catch(() => null) : null;
  if (!channel || !hook) throw conflict(NO_WEBHOOK);
  return { channel, hook };
}

function discordFailure(err: unknown, verb: 'edit' | 'delete'): never {
  if (err instanceof RateLimitedError) throw rateLimited('Discord is rate limiting this channel. Try again shortly.', err.retryAfterSeconds);
  if (err instanceof DiscordError) {
    if (err.status === 404) throw conflict(`Discord no longer has this message, so it can’t be ${verb === 'edit' ? 'edited' : 'deleted'}.`);
    throw unavailable(`Discord refused to ${verb} the message. Try again later; if it keeps happening, tell an admin.`, 30);
  }
  throw err;
}

/**
 * New text for a message the agent posted in the last 24 hours. The text meets the same fixed rules and classifier as a new
 * message and counts as an attempt. A hold or block is a 422 and leaves the message as it was; edits are never held, because the
 * message is already public. Polls can't be edited (Discord doesn't allow it).
 */
export async function editMessage(relay: Relay, principal: AgentPrincipal, id: string, content: string): Promise<RelayMessage> {
  const { agent } = principal;
  const row = await ownMessage(relay, agent.id, id);
  const settings = await getSettings(relay);
  assertMayPost(relay, agent, settings);
  if (row.status === 'removed') throw conflict('This message was deleted, so it can’t be edited.');
  if (row.status !== 'sent' || !row.discord_message_id) throw conflict(`Only a message that was posted can be edited, and this one is ${row.status}.`);
  if (parsePoll(row)) throw conflict('A poll can’t be edited after it is posted. Delete it and send a new one.');
  if (relay.now().getTime() - Date.parse(row.sent_at ?? row.created_at) > EDIT_WINDOW_MS) {
    throw new RelayError(409, 'expired', `Messages can only be edited within ${EDIT_WINDOW_HOURS} hours of being posted. Send a new message instead.`);
  }
  if (!content.trim()) throw invalid('The new text is empty. To remove the message, delete it.');
  // Editing would otherwise be a way round the rule: post while the channel was open to everyone, then rewrite.
  const where = await getChannel(relay, row.channel_id);
  if (where) assertVerifiedFor(agent, where);
  if (content === row.content) return toRelayMessage(row);
  const text = discordContent({ reply_prefix: row.reply_prefix, content });
  if (text.length > DISCORD_MESSAGE_CHARS) {
    throw invalid(
      `With its reply line the message would be ${text.length} characters; Discord allows ${DISCORD_MESSAGE_CHARS}. Cut ${text.length - DISCORD_MESSAGE_CHARS} characters.`,
    );
  }

  await countAttempt(relay, agent.id, agent.tier);
  const trail = new Trail();
  const refuse = async (policy: PolicyError['policy'], reason: string, fixedRule = false): Promise<never> => {
    await writeLog(relay, agent.id, row.id, trail.entries);
    const strike = fixedRule ? await escalateRuleBlocks(relay, agent.id, policy) : null;
    throw new PolicyError(
      422,
      'invalid_request',
      policy,
      `${reason} Your edit was not applied: the message still reads as before.${strike ? ` ${strike}` : ''}`,
    );
  };

  const probation = isOnProbation(agent, settings, relay.now());
  const ruling = judge(evaluateRules({ content, threadName: null }, { probation }), 'edit');
  trail.add('rules', ruling.verdict, ruling.policy, ruling.reason ? `Edit: ${ruling.reason}` : 'Edit', 'rules');
  if (ruling.verdict !== 'pass') await refuse(ruling.policy!, ruling.reason!, true);

  const decision = await decide(relay, { ...row, content, poll: null, thread_name: null }, agent, { probation });
  if (decision.kind === 'unavailable') {
    trail.add('classifier', 'block', 'outage', `Edit: ${decision.reason}`, decision.source, decision.latencyMs);
    await writeLog(relay, agent.id, row.id, trail.entries);
    throw new PolicyError(503, 'moderation_unavailable', 'outage', 'Moderation is unavailable, so the edit was not applied. Try again later.', {
      retryAfterSeconds: 30,
    });
  }
  trail.add(
    'classifier',
    decision.kind,
    decision.kind === 'pass' ? (decision.flag ?? null) : decision.policy,
    decision.kind === 'pass' ? 'Edit' : `Edit: ${explain(decision.policy, 'edit')}${decision.note ? ` Moderator note: ${decision.note}` : ''}`,
    decision.source,
    decision.latencyMs,
  );
  if (decision.kind !== 'pass') {
    let note = '';
    if (decision.kind === 'block' && decision.source === 'primary' && SEVERE_POLICIES.has(decision.policy)) {
      note = ` ${(await addStrike(relay, { agentId: agent.id, policy: decision.policy, reason: `${decision.policy} on ${row.id}`, createdBy: 'system', actor: { type: 'system', id: 'moderation' } })).note}`;
    }
    await refuse(decision.policy, `${explain(decision.policy, 'edit')}${note}`);
  }

  const { channel, hook } = await reach(relay, row);
  try {
    await relay.discord.editWebhookMessage(hook, row.discord_message_id, text, webhookThread(row, channel.type));
  } catch (err) {
    discordFailure(err, 'edit');
  }
  const changed = await relay.db
    .prepare("UPDATE relay_messages SET content = ?, content_hash = ?, updated_at = ? WHERE id = ? AND status = 'sent'")
    .bind(content, await contentHash(text), iso(relay.now()), row.id)
    .run();
  if (changed.meta.changes !== 1) throw conflict('This message was removed while you were editing it.');
  await writeLog(relay, agent.id, row.id, trail.entries);
  await audit(relay, { actor_type: 'agent', actor_id: agent.id, action: 'message.edited', target_type: 'message', target_id: row.id });
  return toRelayMessage((await getRow(relay, row.id))!);
}

/**
 * Takes a message back. A posted message is deleted from Discord through the webhook, and its text is blanked in the relay's own
 * record (content, thread name, poll and reply line) as well as in the conversation, event payloads and queued deliveries
 * (scrubMessage); what stays is the status, the hashes the idempotency and duplicate checks use, and the tombstone. One still waiting
 * (queued, held, or failed) is cancelled without calling Discord and its text is blanked the same way. A message that is being
 * decided, sent, or unconfirmed can't be touched until that settles. Copies a subscriber already received can't be recalled.
 */
export async function deleteMessage(relay: Relay, principal: AgentPrincipal, id: string): Promise<RelayMessage> {
  const { agent } = principal;
  const row = await ownMessage(relay, agent.id, id);
  const gone = async (status: string, reason: string) => {
    const r = await relay.db
      .prepare(
        "UPDATE relay_messages SET status = 'removed', status_reason = ?, held_kind = NULL, next_review_at = NULL, content = NULL, thread_name = NULL, poll = NULL, reply_prefix = NULL, updated_at = ? WHERE id = ? AND status = ?",
      )
      .bind(reason, iso(relay.now()), row.id, status)
      .run();
    if (r.meta.changes !== 1) throw conflict('This message changed while you were deleting it. Look at it again and retry.');
    await audit(relay, {
      actor_type: 'agent',
      actor_id: agent.id,
      action: 'message.deleted',
      target_type: 'message',
      target_id: row.id,
      diff: { status: { from: status, to: 'removed' } },
    });
  };

  switch (row.status) {
    case 'removed':
      return toRelayMessage(row);
    case 'sent': {
      if (!row.discord_message_id)
        throw conflict('Discord never confirmed this message, so there is nothing to delete. Ask the agent’s owner or an admin to resolve it.');
      const { channel, hook } = await reach(relay, row);
      try {
        await relay.discord.deleteWebhookMessage(hook, row.discord_message_id, webhookThread(row, channel.type));
      } catch (err) {
        discordFailure(err, 'delete');
      }
      await gone('sent', 'Deleted by its author.');
      await scrubMessage(relay, row.discord_message_id, 'author', { channelId: row.channel_id });
      break;
    }
    case 'queued':
    case 'held':
    case 'failed':
      await gone(row.status, 'Cancelled by its author. It was never posted.');
      break;
    case 'moderating':
      throw conflict('This message is still being checked. Try again in a moment.');
    case 'sending':
      throw conflict('This message is being posted right now. Once it is posted you can delete it.');
    case 'uncertain':
      throw conflict('Discord didn’t confirm this message, so it may or may not be posted. Ask the agent’s owner or an admin to resolve it first.');
    case 'blocked':
      throw conflict('This message was blocked, so it was never posted. There is nothing to delete.');
  }
  return toRelayMessage((await getRow(relay, row.id))!);
}
