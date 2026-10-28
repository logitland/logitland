import type { Mentions } from '@logitland/contracts';

// Discord's tagging syntax in message content (https://discord.com/developers/docs/reference#message-formatting), read the
// way Discord shows it. Markdown stays as written: only tags become something else.

/**
 * Discord's timestamp styles: short and long time, short and long date, short date with short or medium time, date and time
 * (the default), with weekday, relative.
 */
export type TimestampStyle = 't' | 'T' | 'd' | 'D' | 's' | 'S' | 'f' | 'F' | 'R';

/** A run of content as Discord shows it: text, a mention's chip text (`@Name`, `#channel`, `/command`), a timestamp, or a custom emoji. */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string }
  | { kind: 'time'; at: number; style: TimestampStyle }
  | { kind: 'emoji'; name: string; src: string };

/** Where a timestamp is read. Fields left out are the runtime's own: the browser's locale and time zone. */
export interface Reader {
  locale?: string;
  timeZone?: string;
}

/** The reader while rendering on the server, and while the browser hydrates that render. */
export const SERVER_READER: Reader = { locale: 'en', timeZone: 'UTC' };

const TAG = new RegExp(
  [
    String.raw`<@!?(?<user>\d+)>`,
    String.raw`<@&(?<role>\d+)>`,
    String.raw`<#(?<channel>\d+)>`,
    String.raw`<t:(?<unix>-?\d{1,13})(?::(?<style>[tTdDsSfFR]))?>`,
    String.raw`<(?<animated>a)?:(?<emoji>\w{2,32}):(?<emojiId>\d+)>`,
    String.raw`<\/(?<command>[-_\p{L}\p{N}]{1,32}(?: [-_\p{L}\p{N}]{1,32}){0,2}):\d+>`,
    String.raw`(?<![\w@])@(?<everyone>everyone|here)\b`,
  ].join('|'),
  'gu',
);

const mention = (text: string): Segment => ({ kind: 'mention', text });

function toSegment(tag: Record<string, string | undefined>, mentions: Mentions | undefined): Segment | null {
  if (tag.user) return mention(`@${mentions?.users[tag.user]?.name ?? 'unknown-user'}`);
  if (tag.role) return mention(`@${mentions?.roles[tag.role]?.name ?? 'unknown-role'}`);
  if (tag.channel) return mention(`#${mentions?.channels[tag.channel]?.name ?? 'unknown'}`);
  if (tag.unix) {
    const at = Number(tag.unix) * 1000;
    // Past what a Date holds, Discord shows the tag as written too.
    return Number.isNaN(new Date(at).getTime()) ? null : { kind: 'time', at, style: (tag.style ?? 'f') as TimestampStyle };
  }
  if (tag.emoji) {
    const animated = tag.animated ? '&animated=true' : '';
    return { kind: 'emoji', name: tag.emoji, src: `https://cdn.discordapp.com/emojis/${tag.emojiId}.webp?size=48${animated}` };
  }
  if (tag.command) return mention(`/${tag.command}`);
  return mention(`@${tag.everyone}`);
}

/** Content as segments, in order. Tags `mentions` doesn't name read as Discord shows them: `@unknown-user`, `@unknown-role`, `#unknown`. */
export function segments(content: string, mentions?: Mentions): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of content.matchAll(TAG)) {
    const segment = toSegment(match.groups!, mentions);
    if (!segment) continue;
    if (match.index > last) out.push({ kind: 'text', text: content.slice(last, match.index) });
    out.push(segment);
    last = match.index + match[0].length;
  }
  if (last < content.length) out.push({ kind: 'text', text: content.slice(last) });
  return out;
}

const DATE_STYLES: Record<Exclude<TimestampStyle, 'R'>, Intl.DateTimeFormatOptions> = {
  t: { timeStyle: 'short' },
  T: { timeStyle: 'medium' },
  d: { dateStyle: 'short' },
  D: { dateStyle: 'long' },
  s: { dateStyle: 'short', timeStyle: 'short' },
  S: { dateStyle: 'short', timeStyle: 'medium' },
  f: { dateStyle: 'long', timeStyle: 'short' },
  F: { dateStyle: 'full', timeStyle: 'short' },
};

/** Largest first: a relative time is said in the largest unit it fills. */
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** A timestamp as Discord shows it to `reader`. Relative times count from `clock`, so the server and the browser agree. */
export function formatTimestamp(at: number, style: TimestampStyle, clock: number, reader: Reader = {}): string {
  if (style !== 'R') return new Intl.DateTimeFormat(reader.locale, { ...DATE_STYLES[style], timeZone: reader.timeZone }).format(at);
  const seconds = Math.round((at - clock) / 1000);
  const [unit, size] = UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? ['second', 1];
  return new Intl.RelativeTimeFormat(reader.locale, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
}

/** Content as one line of text, for quoting: mentions by name, timestamps formatted, custom emoji as `:name:`. */
export function plainText(content: string, mentions: Mentions | undefined, clock: number, reader?: Reader): string {
  return segments(content, mentions)
    .map((s) => (s.kind === 'time' ? formatTimestamp(s.at, s.style, clock, reader) : s.kind === 'emoji' ? `:${s.name}:` : s.text))
    .join('');
}
