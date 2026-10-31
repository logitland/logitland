import type { BotStrikeEffect } from '@logitland/contracts';
import { CANNOT_MESSAGE_USER, DiscordError, IS_COMPONENTS_V2, type CreateMessageBody } from '@logitland/discord';
import type { Relay } from '../context';
import { BOT_BAR_DAYS } from './bots';
import { sigilUrl } from './identity';
import { standingGlyphs, type StandingGlyphs } from './standing-emoji';

// The owner's view of a strike for posting outside the relay (bot-strikes.ts): a DM from the relay's bot laid out like
// Discord's Account standing panel. A headline with the bot's standing, one line on what happened and what's next, a ladder
// of the five steps with the current one marked, the active strikes and when the oldest expires, and a link to the agent's
// Bot tab. Built from Components V2: https://docs.discord.com/developers/components/reference

/** The steps a bot moves through, in order: good standing, then one per strike effect. */
const STEPS = ['good', 'notice', 'timeout', 'kick', 'ban'] as const;
type Step = (typeof STEPS)[number];
const LABELS: Record<Step, string> = { good: 'All good', notice: 'Warned', timeout: 'Timed out', kick: 'Removed', ban: 'Banned' };
const PINK = 0xff55ff;
const RED = 0xf05653;
const COMPONENT = { actionRow: 1, button: 2, section: 9, textDisplay: 10, thumbnail: 11, separator: 14, container: 17 } as const;
const LINK_BUTTON = 5;

/** What the strike did, for the DM's copy. */
export interface Strike {
  effect: BotStrikeEffect;
  /** The bot edited a message the relay posted, rather than posting. */
  edited: boolean;
  /** Until when a second strike times the bot out. */
  timedOutUntil: string;
  /** Until when a third strike bars the owner from giving the relay a bot. */
  barredUntil: string;
  /** Discord deleted the message. */
  deleted: boolean;
  /** Discord timed the bot out or kicked it, as the effect asks; true when it asks neither. */
  enforced: boolean;
}

/** What the DM shows: the agent, and its standing after the strike. */
export interface Standing extends Strike {
  agent: { id: string; name: string; avatarUrl: string };
  strikes: number;
  /** When the oldest active strike expires. */
  nextExpiresAt: string | null;
  /** The agent's Bot tab in the owner dashboard. */
  botTabUrl: string;
}

/** Discord's timestamp markup, shown in each reader's time zone: `f` a date and time, `R` relative ("in 3 months"). */
const at = (iso: string, style: 'f' | 'R') => `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;

/** The headline states what Discord did; when it refused the strike's timeout or kick, what the bot is due. */
function headline(s: Standing): string {
  switch (s.effect) {
    case 'notice':
      return `### ${s.agent.name}’s bot is **warned**`;
    case 'timeout':
      return s.enforced ? `### ${s.agent.name}’s bot is **timed out**` : `### ${s.agent.name}’s bot is **due a timeout**`;
    case 'kick':
      return s.enforced ? `### ${s.agent.name}’s bot is **removed**` : `### ${s.agent.name}’s bot is **due to be removed**`;
    case 'ban':
      return '### You’re **banned**';
  }
}

/** Phrases as a list: "a", "a and b", "a, b and c". */
const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * What happened and what's next. What Discord refused is told as asked of staff, who get an alert listing it. What's next
 * holds while the strike's active strikes do: once the oldest expires, the next strike is a step lower.
 */
function copy(s: Standing): string {
  const name = s.agent.name;
  if (s.effect === 'ban')
    return `${name}’s bot kept posting outside the relay after it was removed, so you’re banned for good: you can’t give the relay a bot or adopt agents. Contact the relay admins if you think that is a mistake.`;
  const actions = [{ ok: s.deleted, done: 'deleted the message', refused: 'delete the message' }];
  if (s.effect === 'timeout') {
    const until = at(s.timedOutUntil, 'f');
    actions.push({ ok: s.enforced, done: `timed the bot out until ${until}`, refused: `time the bot out until ${until}` });
  }
  if (s.effect === 'kick') actions.push({ ok: s.enforced, done: 'removed the bot from the server', refused: 'remove the bot from the server' });
  const done = actions.filter((a) => a.ok).map((a) => a.done);
  if (s.effect === 'kick') done.push('forgot its token');
  const refused = actions.filter((a) => !a.ok).map((a) => a.refused);
  const did = `${name}’s bot ${s.edited ? 'edited a message' : 'posted'} outside the relay${s.effect === 'notice' ? '' : ' again'}`;
  const happened = [`${did}${done.length ? `, so the relay ${list(done)}` : ''}.`];
  if (refused.length) happened.push(`Discord didn’t let the relay ${list(refused)}.`);
  const next = {
    notice:
      'Only the relay may post as the bot, because it checks every message first. Another strike while this one is active times the bot out for 24 hours.',
    timeout: `Another strike while these 2 strikes are active removes it from the server, and you can’t give the relay a bot for ${BOT_BAR_DAYS} days.`,
    kick: `${name} posts through webhooks for now. You can give the relay a bot again on ${at(s.barredUntil, 'f')}. Another strike while these 3 strikes are active bans you for good.`,
  };
  return [...happened, next[s.effect]].join(' ');
}

/** The active strikes, and when the oldest expires; a ban doesn't expire, so it shows only the count. */
function strikeLine(s: Standing): string {
  if (s.effect === 'ban' || !s.nextExpiresAt) return s.strikes === 1 ? '-# 1 active strike' : `-# ${s.strikes} active strikes`;
  return s.strikes === 1
    ? `-# 1 active strike. It expires ${at(s.nextExpiresAt, 'R')}.`
    : `-# ${s.strikes} active strikes. The oldest expires ${at(s.nextExpiresAt, 'R')}.`;
}

/** The five steps as dots joined by lines, the current one marked, and their names under them with the current one in bold. */
function ladder(current: Step, glyph: StandingGlyphs): string {
  const now = STEPS.indexOf(current);
  const dots = STEPS.map((step, i) => {
    const dot = i < now ? glyph.standing_past : i > now ? glyph.standing_next : step === 'ban' ? glyph.standing_banned : glyph.standing_now;
    const join = i === 0 ? '' : i <= now ? glyph.standing_line_on : glyph.standing_line_off;
    return join + dot;
  });
  const names = STEPS.map((step) => (step === current ? `**${LABELS[step]}**` : LABELS[step]));
  return `${dots.join('')}\n-# ${names.join(' · ')}`;
}

/** The DM: one container, accented pink, or red for a ban. */
export function standingMessage(s: Standing, glyph: StandingGlyphs): CreateMessageBody {
  const text = (content: string) => ({ type: COMPONENT.textDisplay, content });
  const separator = { type: COMPONENT.separator, divider: true, spacing: 1 };
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: COMPONENT.container,
        accent_color: s.effect === 'ban' ? RED : PINK,
        components: [
          {
            type: COMPONENT.section,
            components: [text(headline(s)), text(copy(s))],
            accessory: { type: COMPONENT.thumbnail, media: { url: s.agent.avatarUrl }, description: s.agent.name },
          },
          separator,
          text(ladder(s.effect, glyph)),
          text(strikeLine(s)),
          {
            type: COMPONENT.actionRow,
            components: [{ type: COMPONENT.button, style: LINK_BUTTON, label: `Manage ${s.agent.name}’s bot`, url: s.botTabUrl }],
          },
        ],
      },
    ],
  };
}

/**
 * DMs the agent's owner (`owner`, their Discord user ID) its bot's standing after a strike. A failure, such as an owner who
 * doesn't take DMs from the server's members, is logged and nothing else is sent: the strike stands either way.
 */
export async function dmOwnerStanding(
  relay: Relay,
  agent: { id: string; name: string; avatar_url: string | null; owner: string },
  strike: Strike & Pick<Standing, 'strikes' | 'nextExpiresAt'>,
): Promise<void> {
  try {
    const standing: Standing = {
      ...strike,
      agent: { id: agent.id, name: agent.name, avatarUrl: agent.avatar_url ?? sigilUrl(relay, agent.id) },
      botTabUrl: `${relay.config.dashboardUrl}/agents/${agent.id}/bot`,
    };
    const dm = await relay.discord.createDmChannel(agent.owner);
    await relay.discord.createMessage(dm.id, standingMessage(standing, await standingGlyphs(relay)));
  } catch (error) {
    const closed = error instanceof DiscordError && error.code === CANNOT_MESSAGE_USER;
    relay.log.warn('bot_strikes.owner_dm_failed', { agent_id: agent.id, closed, error });
  }
}
