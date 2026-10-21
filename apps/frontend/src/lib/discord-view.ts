// What the bot can do in a Discord channel, in plain words.
import type { DiscordChannel } from '@logitland/contracts';

export interface BotSummary {
  /** ok: ready to relay. warn: relayable, but something will go wrong later. fail: the bot can't see the channel. */
  level: 'ok' | 'warn' | 'fail';
  label: string;
  /** What to change in Discord, one sentence each. */
  hints: string[];
}

/** The permissions the relay needs, how to say each, and where it matters. */
export function botSummary(c: DiscordChannel): BotSummary {
  const b = c.bot;
  const hints: string[] = [];
  if (!b.can_view) {
    // Nothing else can be asked of a channel the bot can't see.
    hints.push('The bot can’t see this channel. Give its role View Channel here, then relay it.');
    return { level: 'fail', label: 'Bot can’t see it', hints };
  }
  if (!b.can_read_history) hints.push('Give the bot Read Message History here, so it can catch up after a disconnect.');
  if (!b.can_manage_webhooks) hints.push('Give the bot Manage Webhooks here, so it can create the webhook agents post through.');
  const threads = [!b.can_create_threads && 'Create Public Threads', !b.can_send_in_threads && 'Send Messages in Threads'].filter(Boolean);
  if (threads.length) hints.push(`To let agents start threads, give the bot ${threads.join(' and ')} here.`);
  if (c.relay?.public_mirror && !c.consent_enforced)
    hints.push('Anyone can chat here, not only people who agreed to the mirror. Turn off Send Messages for @everyone and allow it for the consent role.');
  const hard = !b.can_read_history || !b.can_manage_webhooks ? 'warn' : 'ok';
  const label = hard === 'warn' ? 'Bot needs a permission' : hints.length ? 'Bot is ready' : 'Bot has what it needs';
  return { level: hard, label, hints };
}

export type DiscordGroup = { id: string | null; name: string; channels: DiscordChannel[] };

/** The server's channels under their categories, in Discord's order. Channels without a category come first. */
export function byCategory(categories: { id: string; name: string; position: number }[], channels: DiscordChannel[]): DiscordGroup[] {
  const sorted = [...channels].sort((a, z) => a.position - z.position);
  const groups: DiscordGroup[] = [];
  const loose = sorted.filter((c) => c.category_id === null);
  if (loose.length) groups.push({ id: null, name: 'No category', channels: loose });
  for (const cat of [...categories].sort((a, z) => a.position - z.position)) {
    const inside = sorted.filter((c) => c.category_id === cat.id);
    if (inside.length) groups.push({ id: cat.id, name: cat.name, channels: inside });
  }
  return groups;
}
