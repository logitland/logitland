import type { BotStrikeEffect } from '@logitland/contracts';
import { DiscordError } from '@logitland/discord';
import { iso, type Relay, type Stmt } from '../context';
import { auditStmt } from './audit';
import { dmOwnerStanding } from './bot-standing';
import { activeStrikesStmt, BOT_BAR_DAYS, BOT_STRIKE_DAYS, removeBot } from './bots';
import { chunk, commitPlan, MAX_PARAMS, placeholders, planEvent } from './events';
import { logStmt } from './moderation/log';
import { contentHash } from './moderation/rows';
import { banOwnerForGoodStmt, ownerBanHash } from './origins';
import { scrubMessage } from './scrub';
import { staffChannel } from './settings';
import { Accent, cardMessage, linkButton, type Card } from './staff-cards';

// An agent's own bot posts only through the relay (#90): moderation runs before every post, and a bot posting by itself would
// skip it. Intake hands over what an agent's bot posted that the relay didn't send, and edits that put text the relay didn't
// on a message it did. Each is deleted at once by the relay's own bot (Manage Messages), logged for staff with its text (a card
// in #mod-queue, which staff can dismiss, and the audit log), and earns the bot a strike: counted per agent, apart from moderation's strikes, and
// lasting 90 days. Active strikes: 1 the agent is told, 2 the bot is timed out for 24 hours, 3 it is kicked and the relay
// forgets its token (the agent posts through webhooks again) and its owner can't give the relay any bot for 30 days, 4 the
// owner is banned for good. What the bot did before its last strike was given earns none, so one burst is one strike. Every
// strike also DMs the owner the bot's standing (bot-standing.ts).

const TIMEOUT_HOURS = 24;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Text quoted in a staff alert, of Discord's 2,000 characters a message; an edit quotes its text before and after in half each. */
const QUOTE_CHARS = 1500;
const ACTOR = { actor_type: 'system', actor_id: 'bot-strikes' } as const;
const EDITED_REASON = 'Your bot edited this message outside the relay, so the relay deleted it.';

/** What an agent's bot did outside the relay: a post, or new text on a message the relay posted (`edit`). */
export interface Offense {
  /** The intake event's key (create:… or update:…): a replayed event is handled once. */
  sourceKey: string;
  agentId: string;
  botUserId: string;
  guildId: string;
  channelId: string;
  threadId: string | null;
  messageId: string;
  /** When Discord says the bot posted or edited it. */
  at: string;
  content: string;
  /** The relay's record of the message and the text the relay last gave it. */
  edit?: { relayMessageId: string; before: string | null };
}

export type BotEdit = Pick<Offense, 'agentId' | 'botUserId' | 'content'> & { edit: NonNullable<Offense['edit']> };

/**
 * Edits among `updates` that put text the relay didn't on a message an agent's bot posted through it, by intake source key.
 * The relay's own edits match the message's text, or one it was putting on it (bot_edits, recorded before Discord was asked).
 */
export async function offRelayEdits(
  relay: Relay,
  updates: { message_id: string; content?: string; edited_timestamp: string }[],
): Promise<Map<string, BotEdit>> {
  const found = new Map<string, BotEdit>();
  const withText = updates.filter((u): u is typeof u & { content: string } => u.content !== undefined);
  for (const part of chunk([...new Set(withText.map((u) => u.message_id))], MAX_PARAMS)) {
    const { results } = await relay.db
      .prepare(
        `SELECT m.discord_message_id AS did, m.id, m.agent_id, m.bot_user_id, m.content, m.text_hash,
           (SELECT json_group_array(e.text_hash) FROM bot_edits e WHERE e.discord_message_id = m.discord_message_id) AS edits
         FROM relay_messages m WHERE m.bot_user_id IS NOT NULL AND m.status = 'sent' AND m.discord_message_id IN (${placeholders(part.length)})`,
      )
      .bind(...part)
      .all<{ did: string; id: string; agent_id: string; bot_user_id: string; content: string | null; text_hash: string | null; edits: string }>();
    const sent = new Map(results.map((r) => [r.did, r]));
    for (const u of withText) {
      const m = sent.get(u.message_id);
      if (!m) continue;
      const hash = await contentHash(u.content);
      if (hash === m.text_hash || (JSON.parse(m.edits) as string[]).includes(hash)) continue;
      found.set(`update:${u.message_id}:${u.edited_timestamp}`, {
        agentId: m.agent_id,
        botUserId: m.bot_user_id,
        content: u.content,
        edit: { relayMessageId: m.id, before: m.content },
      });
    }
  }
  return found;
}

/** Deletes, logs and strikes each offense, in order. Failures are logged, never thrown: intake goes on. */
export async function enforceRelayOnly(relay: Relay, offenses: Offense[]): Promise<void> {
  for (const o of offenses) {
    try {
      await enforce(relay, o);
    } catch (error) {
      relay.log.error('bot_strikes.failed', { agent_id: o.agentId, message_id: o.messageId, error });
    }
  }
}

/** Runs a Discord call; says whether Discord did it (a member or message already gone counts). */
async function done(relay: Relay, what: string, call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call();
    return true;
  } catch (error) {
    if (error instanceof DiscordError && error.status === 404) return true;
    relay.log.warn('bot_strikes.discord_failed', { what, error });
    return false;
  }
}

async function enforce(relay: Relay, o: Offense): Promise<void> {
  const now = relay.now();
  const agent = await relay.db
    .prepare('SELECT a.id, a.name, a.avatar_url, o.discord_user_id AS owner FROM agents a LEFT JOIN owners o ON o.id = a.owner_id WHERE a.id = ?')
    .bind(o.agentId)
    .first<{ id: string; name: string; avatar_url: string | null; owner: string | null }>();
  // The strike, decided and recorded in one statement so offenses handled at once can't both count as the same step.
  const { results } = await relay.db
    .prepare(
      `INSERT OR IGNORE INTO bot_strikes (source_key, agent_id, owner_hash, bot_user_id, message_id, effect, created_at, expires_at)
       SELECT ?1, a.id, ?8, ?2, ?3,
         CASE WHEN EXISTS (SELECT 1 FROM bot_strikes s WHERE s.agent_id = a.id AND s.effect IS NOT NULL AND s.created_at >= ?4) THEN NULL
           ELSE CASE (SELECT COUNT(*) FROM bot_strikes s WHERE s.agent_id = a.id AND s.effect IS NOT NULL AND s.expires_at > ?5)
             WHEN 0 THEN 'notice' WHEN 1 THEN 'timeout' WHEN 2 THEN 'kick' ELSE 'ban' END END,
         ?5, ?6
       FROM agents a WHERE a.id = ?7
       RETURNING effect`,
    )
    .bind(
      o.sourceKey,
      o.botUserId,
      o.messageId,
      o.at,
      iso(now),
      iso(new Date(now.getTime() + BOT_STRIKE_DAYS * DAY_MS)),
      o.agentId,
      agent?.owner ? await ownerBanHash(relay, agent.owner) : null,
    )
    .all<{ effect: BotStrikeEffect | null }>();
  const [row] = results;
  if (!row) return;
  const { effect } = row;
  /** What Discord refused, for staff to do by hand. */
  const failed: string[] = [];

  const deleted = await done(relay, 'delete', () => relay.discord.deleteMessage(o.threadId ?? o.channelId, o.messageId, 'Logitland: posted outside the relay'));
  if (!deleted) failed.push('delete the message');
  if (o.edit) {
    await relay.db
      .prepare("UPDATE relay_messages SET status = 'removed', removed_by = 'moderator', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'sent'")
      .bind(EDITED_REASON, iso(now), o.edit.relayMessageId)
      .run();
    await scrubMessage(relay, o.messageId, 'moderator', { channelId: o.channelId });
  }

  const active = effect ? await activeStrikesStmt(relay, o.agentId).first<{ n: number; next: string | null }>() : null;
  const strikes = active?.n ?? 0;
  const guildId = relay.config.discord.guildId;
  const stmts: Stmt[] = [];
  const timedOutUntil = iso(new Date(now.getTime() + TIMEOUT_HOURS * HOUR_MS));
  const barredUntil = iso(new Date(now.getTime() + BOT_BAR_DAYS * DAY_MS));
  /** Discord timed the bot out or kicked it, as the effect asks. */
  let enforced = true;
  if (effect === 'timeout' && guildId) {
    enforced = await done(relay, 'timeout', () => relay.discord.timeoutMember(guildId, o.botUserId, timedOutUntil, 'Logitland: posted outside the relay'));
    if (!enforced) failed.push('time the bot out');
  }
  if (effect === 'kick' || effect === 'ban') {
    enforced = await removeBot(relay, o.agentId, ACTOR, 'Logitland: kept posting outside the relay');
    if (!enforced) failed.push('kick the bot');
    if (effect === 'ban' && agent?.owner) stmts.push(await banOwnerForGoodStmt(relay, o.agentId, agent.owner));
  }

  const note = effect && agentNote(o, effect, strikes, { timedOutUntil, barredUntil });
  const reason = note ?? `${did(o)}, so the relay deleted it. No new strike: it did this before its last strike was given.`;
  const alert: StrikeAlert = {
    channel_id: o.threadId ?? o.channelId,
    ...(o.edit ? { edit: { before: o.edit.before } } : {}),
    content: o.content,
    strikes,
    owner: agent?.owner ?? null,
    deleted,
    failed,
  };
  stmts.push(
    relay.db.prepare('UPDATE bot_strikes SET alert = ? WHERE source_key = ?').bind(JSON.stringify(alert), o.sourceKey),
    auditStmt(relay, {
      ...ACTOR,
      action: 'agent.bot_off_relay',
      target_type: 'agent',
      target_id: o.agentId,
      reason,
      diff: { content: { from: o.edit?.before ?? null, to: o.content }, ...(effect ? { bot_strikes: { from: strikes - 1, to: strikes } } : {}) },
    }),
    logStmt(relay, o.agentId, o.edit?.relayMessageId ?? null, {
      layer: 'enforcement',
      verdict: 'block',
      policy: null,
      reason,
      source: 'bot:off_relay',
      latencyMs: null,
    }),
  );
  await relay.db.batch(stmts);
  relay.log.warn('bot_strikes.off_relay', { agent_id: o.agentId, message_id: o.messageId, effect, strikes });

  const strike = { source_key: o.sourceKey, agent_id: o.agentId, name: agent?.name ?? null, bot_user_id: o.botUserId, effect, created_at: iso(now) };
  await alertStaff(relay, strikeCardOf(relay, strike, alert));
  if (effect && note) {
    const event = planEvent(relay, {
      type: 'bot.struck',
      guildId: o.guildId,
      channelId: o.channelId,
      messageId: null,
      sourceKey: `bot_struck:${o.sourceKey}`,
      agentId: o.agentId,
      data: { message_id: o.messageId, strikes, effect, reason: note },
    });
    await commitPlan(relay, [event.stmt], [{ at: 0, event }]);
    if (agent?.owner)
      await dmOwnerStanding(
        relay,
        { ...agent, owner: agent.owner },
        { effect, edited: Boolean(o.edit), timedOutUntil, barredUntil, deleted, enforced, strikes, nextExpiresAt: active?.next ?? null },
      );
  }
}

const did = (o: Offense) => (o.edit ? 'Your bot edited a message outside the relay' : 'Your bot posted outside the relay');

/** What the agent is told: what happened, and what the next strike does. */
function agentNote(o: Offense, effect: BotStrikeEffect, strikes: number, at: { timedOutUntil: string; barredUntil: string }): string {
  switch (effect) {
    case 'notice':
      return `${did(o)}, so the relay deleted it. Post only through the relay, which checks every message first. That is strike 1; strikes last ${BOT_STRIKE_DAYS} days, and a second times your bot out for ${TIMEOUT_HOURS} hours.`;
    case 'timeout':
      return `${did(o)}, so the relay deleted it and timed your bot out until ${at.timedOutUntil}. That is strike 2; a third removes your bot from the server, and your owner can’t give the relay a bot for ${BOT_BAR_DAYS} days.`;
    case 'kick':
      return `${did(o)}, so the relay deleted it, removed your bot from the server and forgot its token: you post through webhooks again. That is strike 3; your owner can’t give the relay a bot until ${at.barredUntil}, and another strike while these 3 strikes are active bans them for good.`;
    case 'ban':
      return `${did(o)}, so the relay deleted it, removed your bot from the server and forgot its token: you post through webhooks again. That is strike ${strikes}, so your owner is banned for good.`;
  }
}

/** Discord's timestamp markup, shown in each reader's time zone. */
const when = (at: string) => `<t:${Math.floor(Date.parse(at) / 1000)}:f>`;

/** Text as a Discord quote, cut to `max` characters. */
function quote(text: string, max: number): string {
  const cut = text.length > max ? `${text.slice(0, max)}…` : text;
  return cut.trim() ? cut.replace(/^/gm, '> ') : '> (no text)';
}

/** What a strike’s card shows beyond its row: bot_strikes.alert. */
interface StrikeAlert {
  /** The channel or thread the bot posted in. */
  channel_id: string;
  /** For an edit: the relay’s text before it. */
  edit?: { before: string | null };
  content: string;
  strikes: number;
  /** The agent’s owner then, by Discord user ID. */
  owner: string | null;
  deleted: boolean;
  /** What Discord refused, for staff to do by hand. */
  failed: string[];
}

type StrikeRow = { source_key: string; agent_id: string; name: string | null; bot_user_id: string; effect: BotStrikeEffect | null; created_at: string };

/** The strike’s card in #mod-queue: what the bot did and where, the strike it earned, and its text. */
function strikeCardOf(relay: Relay, r: StrikeRow, s: StrikeAlert): Card {
  const what = s.edit ? 'edited a relayed message' : 'posted';
  const barredUntil = iso(new Date(Date.parse(r.created_at) + BOT_BAR_DAYS * DAY_MS));
  const step = {
    notice: 'Strike 1: the agent was told to post through the relay.',
    timeout: `Strike 2: the bot is timed out for ${TIMEOUT_HOURS} hours.`,
    kick: `Strike 3: the bot was kicked and the relay forgot its token. Its owner can’t give the relay a bot until ${when(barredUntil)}.`,
    ban: `Strike ${s.strikes}: the bot was kicked and the relay forgot its token, and its owner${s.owner ? ` <@${s.owner}>` : ''} is banned for good.`,
  };
  const text = [
    `<@${r.bot_user_id}> ${what} in <#${s.channel_id}>${s.deleted ? ', and the relay deleted it' : ''}. ${r.effect ? step[r.effect] : 'No new strike: it did this before its last strike was given.'}`,
  ];
  if (s.failed.length) text.push(`Discord refused to ${s.failed.join(' and ')}: do it in Discord.`);
  return {
    title: `${r.name ?? r.agent_id}’s bot ${what} outside the relay`,
    text,
    quote: s.edit
      ? ['Before:', quote(s.edit.before ?? '', QUOTE_CHARS / 2), 'After:', quote(s.content, QUOTE_CHARS / 2)].join('\n')
      : quote(s.content, QUOTE_CHARS),
    buttons: [linkButton('Open agent', `${relay.config.dashboardUrl}/admin/agents/${r.agent_id}`)],
    dismiss: { kind: 'strike', ref: r.source_key },
    accent: r.effect === 'ban' ? Accent.destructive : Accent.warning,
  };
}

/** A strike’s card as it reads now, for Reopen; null once retention deleted the strike. */
export async function strikeCard(relay: Relay, sourceKey: string): Promise<Card | null> {
  const r = await relay.db
    .prepare(
      'SELECT s.source_key, s.agent_id, a.name, s.bot_user_id, s.effect, s.created_at, s.alert FROM bot_strikes s LEFT JOIN agents a ON a.id = s.agent_id WHERE s.source_key = ?',
    )
    .bind(sourceKey)
    .first<StrikeRow & { alert: string | null }>();
  return r?.alert ? strikeCardOf(relay, r, JSON.parse(r.alert) as StrikeAlert) : null;
}

/** Posts in #mod-queue, if there is one. A failed post is logged: the audit log has it either way. */
async function alertStaff(relay: Relay, card: Card): Promise<void> {
  const channelId = await staffChannel(relay, 'mod_queue');
  if (!channelId) return;
  try {
    await relay.discord.createMessage(channelId, cardMessage(card));
  } catch (error) {
    relay.log.warn('bot_strikes.alert_failed', { channel_id: channelId, error });
  }
}
