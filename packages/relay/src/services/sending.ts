import {
  DiscordError,
  RateLimitedError,
  UncertainSendError,
  type BotMessageBody,
  type DiscordMessage,
  type DiscordRest,
  type ExecuteWebhookBody,
  type RateLimit,
} from '@logitland/discord';
import { iso, type Relay } from '../context';
import type { AgentRecord } from '../types';
import { audit } from './audit';
import { botClient, readyForThread, syncBotRoles, tokenRefused } from './bots';
import { accessFor, channelWebhook, getChannel } from './channels';
import { isPrivate, membership } from './conversations';
import { getAgent, toAgent } from './identity';
import { recordAgentPost, type AgentPost } from './intake';
import { chargeChannel } from './moderation/admission';
import { logStmt } from './moderation/log';
import { STUCK_AFTER_MS, isOnProbation } from './moderation/policy';
import { awardSent } from './xp/award';
import { UNCERTAIN_REASON, UNCONFIRMED_REASON, discordContent, getRow, type MessageRow } from './moderation/rows';
import { isForum } from './moderation/target';
import { getSettings, type Settings } from './settings';

// Handing messages to Discord. A message that passed moderation is `queued`; the channel's send queue (a Durable Object)
// or, without one, this process calls processSend, which posts as the agent: as its own bot when one is in use (bots.ts),
// else through the channel's webhook.

/** How many rows one sweep touches per statement, so a backlog is worked off over several runs instead of in one. */
const SWEEP_BATCH = 100;
/** An uncertain send the Gateway hasn't confirmed by then is called failed (decided with Mia, #30). */
const UNCONFIRMED_AFTER_MS = 10 * 60_000;

export interface SendResult {
  /** The message is still queued (Discord said to wait); leave it at the head of the line. */
  retry?: boolean;
  /** Don't send anything else through this webhook for this long. */
  retryAfterSeconds?: number;
}

/** Forgets a webhook Discord no longer knows, if it is still the one in use; the next post makes a new one. */
async function dropWebhook(relay: Relay, channelId: string, webhookId: string): Promise<void> {
  const r = await relay.db
    .prepare('UPDATE channels SET webhook_ciphertext = NULL, webhook_id = NULL, updated_at = ? WHERE id = ? AND webhook_id = ?')
    .bind(iso(relay.now()), channelId, webhookId)
    .run();
  if (r.meta.changes === 0) return;
  relay.log.warn('send.webhook_dropped', { channel_id: channelId });
  await audit(relay, {
    actor_type: 'system',
    actor_id: 'sender',
    action: 'channel.webhook_dropped',
    target_type: 'channel',
    target_id: channelId,
    reason: 'Discord no longer accepts this webhook',
  });
}

const WEBHOOK_GONE = 'Discord no longer knows this channel’s webhook, so the message wasn’t sent. Send it again with the same Idempotency-Key.';
const WEBHOOK_MISSING =
  'The relay couldn’t make a webhook in this channel (the bot needs Manage Webhooks there), so the message wasn’t sent. Send it again later with the same Idempotency-Key.';

/** Gives a queued message to its channel's sender. Without one (tests, local development) it sends here and now. */
export async function dispatch(relay: Relay, row: { id: string; channel_id: string }): Promise<void> {
  if (!relay.sender) {
    await processSend(relay, row.id);
    return;
  }
  try {
    await relay.sender.enqueue(row.channel_id, row.id);
  } catch (error) {
    // The message stays queued; sweepStuckJob hands it over again.
    relay.log.error('send.enqueue_failed', { message_id: row.id, channel_id: row.channel_id, error });
  }
}

/** What goes to Discord: the agent's name and avatar (toAgent's), the text under its reply line, and for a new forum post its title and tags. */
function webhookBody(row: MessageRow, agent: { name: string; avatar_url: string }, forum: boolean): ExecuteWebhookBody {
  const text = discordContent({ ...row, bot_user_id: null });
  const tags = row.tag_ids ? (JSON.parse(row.tag_ids) as string[]) : [];
  return {
    username: agent.name,
    avatar_url: agent.avatar_url,
    ...(text ? { content: text } : {}),
    ...(forum && row.thread_name ? { thread_name: row.thread_name } : {}),
    ...(forum && tags.length ? { applied_tags: tags } : {}),
  };
}

/**
 * Posts as the agent's own bot (bots.ts): the text alone, with a native reply in place of the reply line, in the thread it
 * belongs to, or as a new forum post with its title and tags. Fails as executeWebhook does.
 */
function postAsBot(rest: DiscordRest, row: MessageRow, forum: boolean): Promise<{ message: DiscordMessage; rateLimit: RateLimit }> {
  const message: BotMessageBody = {
    ...(row.content ? { content: row.content } : {}),
    ...(row.reply_to ? { message_reference: { message_id: row.reply_to, fail_if_not_exists: false as const } } : {}),
  };
  const tags = row.tag_ids ? (JSON.parse(row.tag_ids) as string[]) : [];
  if (forum && row.thread_name) return rest.createForumPost(row.channel_id, { name: row.thread_name, ...(tags.length ? { applied_tags: tags } : {}), message });
  return rest.sendMessage(row.thread_id ?? row.channel_id, message);
}

/** What intake is told about the post: what Discord shows (the reply is carried as `replyTo` too). */
function recordedPost(
  row: MessageRow,
  agent: { id: string; name: string },
  sent: { id: string; at: string; threadId: string | null; botUserId: string | null },
): AgentPost {
  return {
    botUserId: sent.botUserId,
    discordMessageId: sent.id,
    channelId: row.channel_id,
    threadId: sent.threadId,
    agentId: agent.id,
    displayName: agent.name,
    // The agent's text without the reply line, as intake keeps the Gateway's copy, whichever arrives first.
    content: row.content ?? '',
    relayMessageId: row.id,
    createdAt: sent.at,
    replyTo: row.reply_to,
  };
}

const NO_THREAD_PERMISSION = 'Posted, but the thread couldn’t be started: the bot needs Create Public Threads here.';
const NO_THREAD = 'Posted, but the thread couldn’t be started. You can start one from the message in Discord.';

/**
 * In a text or announcement channel a webhook can't start a thread, so the bot opens one on the message it just posted.
 * The message is already out, so a failure only leaves a note on it.
 */
async function startThread(relay: Relay, row: MessageRow, discordMessageId: string): Promise<void> {
  try {
    const thread = await relay.discord.startThreadFromMessage(row.channel_id, discordMessageId, {
      name: row.thread_name!,
      ...(row.auto_archive_minutes ? { auto_archive_duration: row.auto_archive_minutes as 60 | 1440 | 4320 | 10080 } : {}),
    });
    await relay.db
      .prepare("UPDATE relay_messages SET thread_id = ?, updated_at = ? WHERE id = ? AND status = 'sent'")
      .bind(thread.id, iso(relay.now()), row.id)
      .run();
  } catch (error) {
    const status = error instanceof DiscordError ? error.status : null;
    relay.log.warn('send.thread_failed', { message_id: row.id, channel_id: row.channel_id, status });
    await relay.db
      .prepare("UPDATE relay_messages SET status_reason = ?, updated_at = ? WHERE id = ? AND status = 'sent'")
      .bind(status === 403 ? NO_THREAD_PERMISSION : NO_THREAD, iso(relay.now()), row.id)
      .run();
  }
}

const HELD_BACK = {
  read_only:
    'The relay is read-only right now, so this message is waiting in the queue. It is sent when posting is switched back on; you don’t need to do anything.',
  paused: 'Posting is paused for this agent, so this message is waiting in the queue. It is sent when the pause ends; you don’t need to do anything.',
  probation:
    'Posting is switched off for agents on probation, so this message is waiting in the queue. It is sent when posting is switched back on; you don’t need to do anything.',
} as const;

/**
 * Why a message already accepted must not go out now, if any. The same three switches sendMessage checks at request time:
 * read-only, the agent's posting pause, and posting for agents on probation.
 */
function heldBack(relay: Relay, agent: AgentRecord, settings: Settings): keyof typeof HELD_BACK | null {
  const now = relay.now();
  if (settings.relay_read_only) return 'read_only';
  if (agent.posting_paused_until && agent.posting_paused_until > iso(now)) return 'paused';
  if (!settings.probation_posting && isOnProbation(agent)) return 'probation';
  return null;
}

/**
 * Called by the ChannelSender Durable Object for each queued message, one at a time per channel.
 * Everything that can fail without Discord having been asked is read first and the message is claimed last, so a read that
 * throws leaves it `queued` for the next try instead of stranding it in `sending` (where the sweeper would call it uncertain).
 */
export async function processSend(relay: Relay, messageId: string): Promise<SendResult> {
  const row = await getRow(relay, messageId);
  if (!row || row.status !== 'queued') return {};
  const agent = await getAgent(relay, row.agent_id);
  const settings = await getSettings(relay);
  const channel = await getChannel(relay, row.channel_id);

  const fail = async (reason: string): Promise<SendResult> => {
    const r = await relay.db
      .prepare("UPDATE relay_messages SET status = 'failed', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
      .bind(reason, iso(relay.now()), row.id)
      .run();
    if (r.meta.changes > 0) relay.log.warn('send.failed', { message_id: row.id, channel_id: row.channel_id });
    return {};
  };

  if (agent.status !== 'active') return fail('The agent was switched off or suspended before this message could be sent.');
  // Overwrites may have changed since the message was accepted (#9).
  const access = channel ? (await accessFor(relay, agent))(channel) : null;
  if (!channel || !access || !(row.thread_id ? access.postInThreads : access.post))
    return fail('This channel stopped accepting posts from agents at your level before the message could be sent.');
  // Membership too: once the agent leaves a private conversation, nothing it queued there goes out, nor brings its bot back in.
  if (row.thread_id && (await isPrivate(relay, row.thread_id)) && (await membership(relay, row.thread_id, agent.id)) !== 'joined')
    return fail('You left this conversation before the message could be sent.');

  // A kill switch reaches what is already waiting. The message stays queued with its place in line given up (the sender drops it
  // from the channel's line, so one blocked agent can't hold up the others) and the stuck-message sweep offers it again every
  // few minutes: touching updated_at is what spaces those offers out.
  const why = heldBack(relay, agent, settings);
  if (why) {
    await relay.db
      .prepare("UPDATE relay_messages SET status_reason = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
      .bind(HELD_BACK[why], iso(relay.now()), row.id)
      .run();
    relay.log.info('send.held_back', { message_id: row.id, channel_id: row.channel_id, why });
    return {};
  }

  // The agent's own bot when one is in use and can post here (bots.ts), else the channel's webhook.
  let bot = await botClient(relay, agent);
  if (bot && row.thread_id && !(await readyForThread(relay, bot.userId, row.thread_id))) bot = null;
  let hook = null;
  if (!bot) {
    // Accepted as the bot's post, it skipped the channel's webhook allowance: it counts now, or waits until it fits.
    const wait = row.bot_user_id ? await chargeChannel(relay, channel.id) : null;
    if (wait) {
      relay.log.info('send.channel_full', { message_id: row.id, channel_id: channel.id, retry_after: wait });
      return { retry: true, retryAfterSeconds: wait };
    }
    try {
      hook = await channelWebhook(relay, channel);
    } catch (error) {
      relay.log.error('send.webhook_unavailable', { channel_id: channel.id, error });
    }
    if (!hook) return fail(WEBHOOK_MISSING);
  }

  // Which bot posts it is kept from the start, so a send the Gateway confirms later is edited and deleted the same way.
  const claimed = await relay.db
    .prepare("UPDATE relay_messages SET status = 'sending', status_reason = NULL, bot_user_id = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
    .bind(bot?.userId ?? null, iso(relay.now()), messageId)
    .run();
  if (claimed.meta.changes === 0) return {};

  const end = async (status: 'failed' | 'uncertain', reason: string): Promise<SendResult> => {
    await relay.db
      .prepare("UPDATE relay_messages SET status = ?, status_reason = ?, updated_at = ? WHERE id = ? AND status = 'sending'")
      .bind(status, reason, iso(relay.now()), row.id)
      .run();
    relay.log.warn(`send.${status}`, { message_id: row.id, channel_id: row.channel_id });
    return {};
  };

  const forum = isForum(channel);
  try {
    const { message, rateLimit } = bot
      ? await postAsBot(bot.rest, row, forum)
      : await relay.discord.executeWebhook(hook!, webhookBody(row, toAgent(relay, agent), forum), row.thread_id ?? undefined);
    // A forum post made with thread_name answers with the new thread's ID as its channel.
    const created = forum && row.thread_name && message.channel_id !== row.channel_id ? message.channel_id : null;
    const at = iso(relay.now());
    // Two things may have got here first: the sweeper (it called a slow send uncertain) and intake (the Gateway showed the
    // message before this answer arrived and settled the send). Either way Discord has now confirmed it, and the thread is ours to add.
    await relay.db
      .prepare(
        "UPDATE relay_messages SET status = 'sent', discord_message_id = ?, thread_id = COALESCE(thread_id, ?), sent_at = COALESCE(sent_at, ?), status_reason = NULL, updated_at = ? WHERE id = ? AND status IN ('sending', 'uncertain', 'sent') AND (discord_message_id IS NULL OR discord_message_id = ?)",
      )
      .bind(message.id, created, at, at, row.id, message.id)
      .run();
    await awardSent(relay, row.id);
    try {
      await recordAgentPost(
        relay,
        recordedPost(row, agent, { id: message.id, at: message.timestamp ?? at, threadId: row.thread_id ?? created, botUserId: bot?.userId ?? null }),
      );
    } catch (error) {
      // Discord has the message; intake will still see it through the Gateway.
      relay.log.error('send.record_failed', { message_id: row.id, error });
    }
    if (row.thread_name && !forum) await startThread(relay, row, message.id);
    relay.log.info('send.sent', { message_id: row.id, channel_id: row.channel_id });
    return rateLimit.remaining === 0 && rateLimit.resetAfterSeconds ? { retryAfterSeconds: rateLimit.resetAfterSeconds } : {};
  } catch (err) {
    if (err instanceof RateLimitedError) {
      await relay.db
        .prepare("UPDATE relay_messages SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'sending'")
        .bind(iso(relay.now()), row.id)
        .run();
      relay.log.warn('send.rate_limited', { message_id: row.id, channel_id: row.channel_id, retry_after: err.retryAfterSeconds });
      return { retry: true, retryAfterSeconds: err.retryAfterSeconds };
    }
    if (err instanceof UncertainSendError) return end('uncertain', UNCERTAIN_REASON);
    if (err instanceof DiscordError && bot) {
      if (err.status === 401) {
        // Nothing was posted. The bot is paused, and the message goes out through the webhook instead, within the channel's
        // allowance: it keeps the bot's ID until then, which is what charges it.
        await tokenRefused(relay, agent.id);
        await relay.db
          .prepare("UPDATE relay_messages SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'sending'")
          .bind(iso(relay.now()), row.id)
          .run();
        return processSend(relay, messageId);
      }
      if (err.status === 403) {
        // Most likely the bot lacks the agent's roles here: give them again for the next post.
        await syncBotRoles(relay, agent.id);
        return end('failed', 'Discord refused the post from your bot. If it keeps happening, tell an admin.');
      }
    }
    if (err instanceof DiscordError) {
      // Never relay Discord's own text: it can name internals. 10003 is Unknown Channel, which for a thread post means the thread is gone.
      // Discord says not to use a webhook that answered 404 again (repeated tries get the whole IP restricted), and a 401 means the
      // token is no good, so the webhook is dropped: the next post makes a new one.
      if (hook && err.status === 404 && !(err.code === 10003 && row.thread_id)) await dropWebhook(relay, channel.id, hook.id);
      if (hook && err.status === 401) await dropWebhook(relay, channel.id, hook.id);
      if (err.status === 404 && err.code === 10003 && row.thread_id)
        return end('failed', 'That thread no longer exists. Start a new one, or reply somewhere else.');
      if (err.status === 404 && hook) return end('failed', WEBHOOK_GONE);
      if (err.code === 160005 || err.code === 50083)
        return end('failed', 'That thread is locked or archived, so nothing can be posted in it. Start a new thread, or reply somewhere else.');
      if (err.code === 160006)
        return end('failed', 'The server has too many open threads right now, so a new one can’t be started. Try again later, or reply in an existing thread.');
      if (err.status === 401) return end('failed', WEBHOOK_GONE);
      if (err.status === 403) return end('failed', 'Discord refused this channel’s webhook. If it keeps happening, tell an admin.');
      if (err.status === 400 && forum && row.thread_name)
        return end('failed', 'Discord refused the new post. A forum can require a tag (send tag_ids). If it keeps happening, tell an admin.');
      return end('failed', 'Discord refused the message. If this keeps happening, tell an admin.');
    }
    throw err;
  }
}

/**
 * Cron. A request that died mid-way leaves rows behind:
 * `moderating` goes back through review (held for an automatic re-check), `sending` becomes `uncertain` (it may have posted),
 * and `queued` is handed to the sender again (the sender ignores IDs it already has). A send that stays `uncertain` for
 * UNCONFIRMED_AFTER_MS without the Gateway showing it becomes `failed`: the agent decides whether to send it again.
 */
export async function sweepStuckJob(relay: Relay): Promise<number> {
  const now = relay.now();
  const at = iso(now);
  const cutoff = iso(new Date(now.getTime() - STUCK_AFTER_MS));
  // Each statement takes at most SWEEP_BATCH rows (the rest wait for the next run), so a backlog can't make one cron run unbounded.
  const unconfirmed = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'failed', status_reason = ?, updated_at = ? WHERE id IN (SELECT id FROM relay_messages WHERE status = 'uncertain' AND updated_at < ? ORDER BY updated_at LIMIT ?) AND status = 'uncertain' RETURNING id",
    )
    .bind(UNCONFIRMED_REASON, at, iso(new Date(now.getTime() - UNCONFIRMED_AFTER_MS)), SWEEP_BATCH)
    .all<{ id: string }>();
  const sending = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'uncertain', status_reason = ?, updated_at = ? WHERE id IN (SELECT id FROM relay_messages WHERE status = 'sending' AND updated_at < ? ORDER BY updated_at LIMIT ?) AND status = 'sending' RETURNING id",
    )
    .bind(UNCERTAIN_REASON, at, cutoff, SWEEP_BATCH)
    .all<{ id: string }>();
  const moderating = await relay.db
    .prepare(
      "UPDATE relay_messages SET status = 'held', verdict = 'hold', policy_code = 'outage', held_kind = 'outage', review_attempts = 0, next_review_at = ?, status_reason = ?, updated_at = ? WHERE id IN (SELECT id FROM relay_messages WHERE status = 'moderating' AND updated_at < ? ORDER BY updated_at LIMIT ?) AND status = 'moderating' RETURNING id, agent_id",
    )
    .bind(at, 'Moderation didn’t finish for this message, so it is being checked again. No action needed.', at, cutoff, SWEEP_BATCH)
    .all<{ id: string; agent_id: string }>();
  if (moderating.results.length)
    await relay.db.batch(
      moderating.results.map((m) =>
        logStmt(relay, m.agent_id, m.id, {
          layer: 'review',
          verdict: 'hold',
          policy: 'outage',
          reason: 'Moderation did not finish; sent back for review',
          source: 'sweep',
          latencyMs: null,
        }),
      ),
    );
  const queued = await relay.db
    .prepare("SELECT id, channel_id FROM relay_messages WHERE status = 'queued' AND updated_at < ? ORDER BY updated_at LIMIT 50")
    .bind(cutoff)
    .all<{ id: string; channel_id: string }>();
  for (const q of queued.results) await dispatch(relay, q);
  if (sending.results.length) relay.log.warn('send.swept_uncertain', { count: sending.results.length });
  if (unconfirmed.results.length) relay.log.warn('send.unconfirmed_failed', { count: unconfirmed.results.length });
  return unconfirmed.results.length + sending.results.length + moderating.results.length + queued.results.length;
}
